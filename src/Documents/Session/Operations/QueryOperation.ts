import { InMemoryDocumentSessionOperations } from "../InMemoryDocumentSessionOperations";
import { IndexQuery } from "../../Queries/IndexQuery";
import { QueryResult } from "../../Queries/QueryResult";
import { FieldsToFetchToken } from "../Tokens/FieldsToFetchToken";
import { Stopwatch } from "../../../Utility/Stopwatch";
import { getLogger } from "../../../Utility/LogUtil";
import { QueryCommand } from "../../Commands/QueryCommand";
import { throwError } from "../../../Exceptions";
import { IDisposable } from "../../../Types/Contracts";
import * as StringBuilder from "string-builder";
import { 
    DocumentType, 
} from "../../DocumentAbstractions";
import { CONSTANTS } from "../../../Constants";
import { TypeUtil } from "../../../Utility/TypeUtil";

const log = getLogger({ module: "QueryOperation" });

export class QueryOperation {
    private _session: InMemoryDocumentSessionOperations;
    private _indexName: string;
    private _indexQuery: IndexQuery;
    private _metadataOnly: boolean;
    private _indexEntriesOnly: boolean;
    private _currentQueryResults: QueryResult;
    private _fieldsToFetch: FieldsToFetchToken;
    private _sp: Stopwatch;
    private _disableEntitiesTracking: boolean;

    public constructor(
        session: InMemoryDocumentSessionOperations, 
        indexName: string, 
        indexQuery: IndexQuery,
        fieldsToFetch: FieldsToFetchToken, 
        disableEntitiesTracking: boolean, 
        metadataOnly: boolean, 
        indexEntriesOnly: boolean) {
        this._session = session;
        this._indexName = indexName;
        this._indexQuery = indexQuery;
        this._fieldsToFetch = fieldsToFetch;
        this._disableEntitiesTracking = disableEntitiesTracking;
        this._metadataOnly = metadataOnly;
        this._indexEntriesOnly = indexEntriesOnly;

        this._assertPageSizeSet();
    }

    public createRequest(): QueryCommand {
        this._session.incrementRequestCount();

        this.logQuery();

        return new QueryCommand(
            this._session.conventions, this._indexQuery, this._metadataOnly, this._indexEntriesOnly);
    }

    public getCurrentQueryResults(): QueryResult {
        return this._currentQueryResults;
    }

    public setResult(queryResult: QueryResult): void {
        this.ensureIsAcceptableAndSaveResult(queryResult);
    }

    private _assertPageSizeSet(): void {
        if (!this._session.conventions.isThrowIfQueryPageSizeIsNotSet()) {
            return;
        }

        if (this._indexQuery.pageSizeSet) {
            return;
        }

        throwError("InvalidOperationException", 
            "Attempt to query without explicitly specifying a page size. " +
                "You can use .take() methods to set maximum number of results. " +
                "By default the page size is set to Integer.MAX_VALUE and can cause severe performance degradation.");
    }

    private _startTiming(): void {
        this._sp = Stopwatch.createStarted();
    }

    public logQuery(): void {
        log.info(
            "Executing query '" + this._indexQuery.query + "'"
            + (this._indexName ? "' on index '" + this._indexName + "'" : "")
            + " in " + this._session.storeIdentifier);
    }

    public enterQueryContext(): IDisposable {
        this._startTiming();

        if (!this._indexQuery.waitForNonStaleResults) {
            return null;
        }

        return this._session.documentStore.disableAggressiveCaching(this._session.databaseName);
    }

    public complete<T extends object>(documentType?: DocumentType<T>): T[] {
        const queryResult = this._currentQueryResults.createSnapshot();

        if (!this._disableEntitiesTracking) {
            this._session.registerIncludes(queryResult.includes);
        }

        const list: T[] = [];

        try {
            for (const document of queryResult.results) {
                const metadata = document[CONSTANTS.Documents.Metadata.KEY];
                const idNode = metadata[CONSTANTS.Documents.Metadata.ID];

                let id = null;
                if (idNode && TypeUtil.isString(idNode)) {
                    id = idNode;
                }

                list.push(
                    QueryOperation.deserialize(
                        id, 
                        document, 
                        metadata, 
                        this._fieldsToFetch, 
                        this._disableEntitiesTracking, 
                        this._session, 
                        documentType));
            }
        } catch (err) {
            log.warn(err, "Unable to read query result JSON.");
            throwError("RavenException", "Unable to read json.", err);
        }

        if (!this._disableEntitiesTracking) {
            this._session.registerMissingIncludes(
                queryResult.results, queryResult.includes, queryResult.includedPaths);
        }

        return list;
    }

    public static deserialize<T extends object>(
        id: string, 
        document: object, 
        metadata: object, 
        fieldsToFetch: FieldsToFetchToken, 
        disableEntitiesTracking: boolean, 
        session: InMemoryDocumentSessionOperations,
        clazz?: DocumentType<T> 
    ) {
        const projection = metadata["@projection"];
        if (TypeUtil.isNullOrUndefined(projection) || projection === false) {
            const entityType = session.conventions.findEntityType(clazz);
            return session.trackEntity(entityType, id, document, metadata, disableEntitiesTracking);
        }

        // return primitives only if type was not passed at all AND fields count is 1
        // if type was passed then use that even if it's only 1 field
        if (fieldsToFetch && fieldsToFetch.projections 
            && fieldsToFetch.projections.length === 1
            && !clazz) {
            // we only select a single field
            const projectField = fieldsToFetch.projections[0];
            const jsonNode = document[projectField];
            if (!TypeUtil.isNullOrUndefined(jsonNode)
                && TypeUtil.isPrimitive(jsonNode)) {
                return jsonNode || null;
            }

            const inner = document[projectField];
            if (TypeUtil.isNullOrUndefined(inner)) {
                return null;
            }

            if (!TypeUtil.isNullOrUndefined(fieldsToFetch.fieldsToFetch)
                && fieldsToFetch.fieldsToFetch[0] === fieldsToFetch.projections[0]) {
                if (TypeUtil.isObject(inner)) { // extraction from original type
                    document = inner;
                }
            }
        }

        const raw: T = session.conventions.entityObjectMapper
            .fromObjectLiteral(document);
        const projType = session.conventions.findEntityType(clazz);
        const projectionResult = projType
            // tslint:disable-next-line:new-parens
            ? new (Function.prototype.bind.apply(projType))
            : {};
        // tslint:disable-next-line:no-shadowed-variable
        const result = fieldsToFetch && fieldsToFetch.projections 
            ? fieldsToFetch.projections.reduce((reduced, key, i) => {
                    reduced[key] = raw[fieldsToFetch.projections[i]];
                    return reduced;
                }, projectionResult)
            : Object.assign(projectionResult, raw);

        if (id) {
            // we need to make an additional check, since it is possible that a value was explicitly stated
            // for the identity property, in which case we don't want to override it.
            const identityProperty = session.conventions.getIdentityProperty(clazz);
            if (identityProperty) {
                const value = document[identityProperty];

                if (!value) {
                    session.generateEntityIdOnTheClient.trySetIdentity(result, id);
                }
            }
        }

        return result;
    }

    public isDisableEntitiesTracking(): boolean {
        return this._disableEntitiesTracking;
    }

    public setDisableEntitiesTracking(disableEntitiesTracking: boolean): void {
        this._disableEntitiesTracking = disableEntitiesTracking;
    }

    public ensureIsAcceptableAndSaveResult(result: QueryResult): void {
        if (!result) {
            throwError("IndexDoesNotExistException", `Could not find index ${this._indexName}.`);
        }

        QueryOperation.ensureIsAcceptable(result, this._indexQuery.waitForNonStaleResults, this._sp, this._session);

        this._currentQueryResults = result;

        // logging
        const isStale = result.isStale ? " stale " : " ";

        const parameters = new StringBuilder();
        if (this._indexQuery.queryParameters 
            && this._indexQuery.queryParameters.length) {
            parameters.append("(parameters: ");

            let first = true;

            const queryParameters = this._indexQuery.queryParameters;
            for (const parameterKey of Object.keys(queryParameters)) {
                const parameterValue = queryParameters[parameterKey];
                if (!first) {
                    parameters.append(", ");
                }

                parameters.append(parameterKey)
                    .append(" = ")
                    .append(parameterValue);

                first = false;
            }

            parameters.append(") ");
        }

        log.info("Query '" 
            + this._indexQuery.query + "' " 
            + parameters.toString() 
            + "returned " 
            + result.results.length + isStale + "results (total index results: " + result.totalResults + ")");
        // end logging
    }

    public static ensureIsAcceptable(
        result: QueryResult, 
        waitForNonStaleResults: boolean, 
        duration: Stopwatch, 
        session: InMemoryDocumentSessionOperations): void {
        if (waitForNonStaleResults && result.isStale) {
            duration.stop();

            const msg = "Waited for " + duration.toString() + " for the query to return non stale result.";
            throwError("TimeoutException", msg);

        }
    }

    public get indexQuery(): IndexQuery {
        return this._indexQuery;
    }
}
