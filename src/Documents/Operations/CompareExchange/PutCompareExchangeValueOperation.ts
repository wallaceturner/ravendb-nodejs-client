import { HttpRequestBase } from "../../../Primitives/Http";
import { IOperation, OperationResultType } from "../OperationAbstractions";
import { CompareExchangeResult } from "./CompareExchangeResult";
import { RavenCommand } from "../../../Http/RavenCommand";
import { IDocumentStore } from "../../IDocumentStore";
import { DocumentConventions } from "../../Conventions/DocumentConventions";
import { HttpCache } from "../../../Http/HttpCache";
import { throwError } from "../../../Exceptions";
import { ServerNode } from "../../../Http/ServerNode";
import { JsonSerializer } from "../../../Mapping/Json/Serializer";
import { ClassConstructor, ObjectTypeDescriptor } from "../../..";
import { TypeUtil } from "../../../Utility/TypeUtil";

export class PutCompareExchangeValueOperation<T> implements IOperation<CompareExchangeResult<T>> {

    private _key: string;
    private _value: T;
    private _index: number;
    
    public constructor(key: string, value: T, index: number) {
        this._key = key;
        this._value = value;
        this._index = index;
    }

    public getCommand(
        store: IDocumentStore,
        conventions: DocumentConventions,
        cache: HttpCache): RavenCommand<CompareExchangeResult<T>> {
        return new PutCompareExchangeValueCommand<T>(this._key, this._value, this._index, conventions);
    }

    public get resultType(): OperationResultType {
        return "CommandResult";
    }
}

export class PutCompareExchangeValueCommand<T> extends RavenCommand<CompareExchangeResult<T>> {
    private _key: string;
    private _value: T;
    private _index: number;
    private _conventions: DocumentConventions;

    public constructor(
        key: string,
        value: T,
        index: number,
        conventions: DocumentConventions) {
        super();

        if (!key) {
            throwError("InvalidArgumentException", "The key argument must have value");
        }

        if (index < 0) {
            throwError("InvalidArgumentException", "Index must be a non-negative number");
        }

        this._key = key;
        this._value = value;
        this._index = index;
        this._conventions = conventions || DocumentConventions.defaultConventions;
    }

    public get isReadRequest(): boolean {
        return false;
    }

    public createRequest(node: ServerNode): HttpRequestBase {
        const uri = node.url + "/databases/" + node.database + "/cmpxchg?key=" + this._key + "&index=" + this._index;

        const tuple = {};
        tuple["Object"] = this._value;

        const json = tuple;

        return {
            method: "PUT",
            uri,
            body: JsonSerializer.getDefault().serialize(tuple),
            headers: this._getHeaders().withContentTypeJson().build()
        };
    }

    public setResponse(response: string, fromCache: boolean): void {
        if (TypeUtil.isPrimitive(this._value)) {
            this.result = CompareExchangeResult.parseFromString(response, this._conventions, null);
        } else {
            const type = this._conventions.getEntityTypeDescriptor(this._value as any) as ObjectTypeDescriptor;
            this.result = CompareExchangeResult.parseFromString(
                response, 
                this._conventions, 
                (TypeUtil.isClass(type) ? type : null) as any as ClassConstructor) as CompareExchangeResult<T>;
        }
    }
}
