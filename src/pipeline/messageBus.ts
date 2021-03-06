import {ActionData, ActionResponse, CommandManager, EventData} from './actions';
import {IActionBusAdapter, IEventBusAdapter} from '../bus/busAdapter';
import {DefaultServiceNames} from '../di/annotations';
import * as RX from 'rxjs';
import { System } from '../configurations/globals/system';
import { RequestContext } from '../servers/requestContext';

export class MessageBus {
    private commandBus: IActionBusAdapter;
    private eventBus: IEventBusAdapter;
    private _events: Map<string,RX.Subject<EventData>> = new Map<string, RX.Subject<EventData>>();

    public getEventsQueue(domain:string): RX.Observable<EventData> {
        let events = this._events.get(domain);
        if (!events) {
            events = new RX.Subject<EventData>();
            this._events.set(domain, events);
            this.eventBus.consumeEvents(domain, this.consumeEventAsync.bind(this));
        }
        return <RX.Observable<EventData>>events;
    }

    constructor(private manager: CommandManager, hasAsyncActions:boolean) {
        this.commandBus = manager.container.get<IActionBusAdapter>(DefaultServiceNames.ActionBusAdapter);
        if ( this.commandBus && hasAsyncActions ) // Register for async tasks only if necessary
        {
            this.commandBus.consumeTask(manager.domain.name, manager.serviceId, manager.consumeTaskAsync.bind(manager));
        }

        this.eventBus = manager.container.get<IEventBusAdapter>(DefaultServiceNames.EventBusAdapter);
    }

    private consumeEventAsync(event: EventData) {
        try {
            (<RX.Subject<EventData>>this.getEventsQueue(event.domain)).next(event);
        }
        catch (e) {
            System.log.error(
                null,
                e,
                ()=>`Consume event action: ${event.action} ${event.schema ? "schema: " + event.schema : ""} tenant: ${event.tenant}`
            );
        }
    }

    pushTask(command: ActionData) {
        command.status = "Pending";
        command.taskId = RequestContext.createCorrelationId();
        this.commandBus && this.commandBus.publishTask(command.domain, this.manager.serviceId, command);
    }

    sendEvent(event: ActionResponse<any>) {
        event.inputSchema = null;
        (<any>event).eventId = RequestContext.createCorrelationId();
        this.eventBus.sendEvent(event.domain, event);
    }
}
