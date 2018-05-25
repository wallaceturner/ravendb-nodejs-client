import { HttpRequestBase } from "../../../Primitives/Http";
import { IMaintenanceOperation, OperationResultType } from "../OperationAbstractions";
import { ModifyOngoingTaskResult } from "../../../ServerWide/ModifyOnGoingTaskResult";
import { ExternalReplication } from "../../Replication/ExternalReplication";
import { RavenCommand } from "../../../Http/RavenCommand";
import { DocumentConventions } from "../../Conventions/DocumentConventions";
import { ServerNode } from "../../../Http/ServerNode";

export class UpdateExternalReplicationOperation implements IMaintenanceOperation<ModifyOngoingTaskResult> {

    private _newWatcher: ExternalReplication;

    public constructor(newWatcher: ExternalReplication) {
        this._newWatcher = newWatcher;
    }

    public getCommand(conventions: DocumentConventions): RavenCommand<ModifyOngoingTaskResult> {
        return new UpdateExternalReplicationCommand(this._newWatcher);
    }

    public get resultType(): OperationResultType {
        return "COMMAND_RESULT";
    }
}

export class UpdateExternalReplicationCommand extends RavenCommand<ModifyOngoingTaskResult> {
    private _newWatcher: ExternalReplication;

    public constructor(newWatcher: ExternalReplication) {
        super();
        this._newWatcher = newWatcher;
    }

    public createRequest(node: ServerNode): HttpRequestBase {
        const uri = node.url + "/databases/" + node.database + "/admin/tasks/external-replication";

        const headers = this._getHeaders()
            .withContentTypeJson().build();
        const body = this._serializer.serialize({ watcher: this._newWatcher });
        return {
            method: "POST",
            uri,
            headers,
            body
        };
    }

    public get isReadRequest(): boolean {
        return false;
    }

    public setResponse(response: string, fromCache: boolean): void {
        if (!response) {
            this._throwInvalidResponse();
        }

        this.result = this._serializer.deserialize(response);
    }
}
