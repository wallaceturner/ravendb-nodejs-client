import {RavenCommand} from '../RavenCommand';
import {ServerNode} from '../../Http/ServerNode';
import {IRavenResponse} from "../RavenCommandResponse";
import {IResponse} from "../../Http/Response/IResponse";
import {RequestMethods} from "../../Http/Request/RequestMethod";
import {InvalidOperationException, ErrorResponseException} from "../DatabaseExceptions";
import {StringUtil} from "../../Utility/StringUtil";
import {DatabaseDocument} from "../DatabaseDocument";

export class CreateDatabaseCommand extends RavenCommand {
  protected databaseDocument: DatabaseDocument;

  constructor(databaseDocument: DatabaseDocument) {
    super('', RequestMethods.Put);
    this.databaseDocument = databaseDocument;
  }

  public createRequest(serverNode: ServerNode): void {
    const dbName: string = this.databaseDocument.databaseId.replace('Raven/Databases/', '');

    StringUtil.validateDBName(dbName);

    if (!('Raven/DataDir' in this.databaseDocument.settings)) {
      throw new InvalidOperationException("The Raven/DataDir setting is mandatory");
    }

    this.params = {name: dbName};
    this.endPoint = StringUtil.format('{url}/admin/databases', serverNode);
    this.payload = this.databaseDocument.toJson();
  }

  public setResponse(response: IResponse): IRavenResponse | IRavenResponse[] | void {
    const result: IRavenResponse = <IRavenResponse>super.setResponse(response);  

    if (!response.body) {
      throw new ErrorResponseException('Response is invalid.')
    }

    return result;
  }
}
