import {Preloader} from './preloader';
import {HystrixSSEStream as hystrixStream} from './commands/http/hystrixSSEStream';
import {ICommandBusAdapter, IEventBusAdapter} from './bus/busAdapter';
import {LocalAdapter} from './bus/localAdapter';
import * as Path from 'path'
import { Domain } from './schemas/schema'
import { Container } from './di/containers'
import { Files } from './utils/files'
import { ExpressAdapter } from './servers/expressAdapter'
import 'reflect-metadata'
import {DefaultServiceNames} from './di/annotations';
import {IContainer} from "./di/resolvers";
import {AbstractAdapter} from './servers/abstractAdapter';
import {DynamicConfiguration, VulcainLogger} from 'vulcain-configurationsjs'
import {Conventions} from './utils/conventions';
import {MemoryProvider} from "./providers/memory/provider";
import {UserContext} from './servers/requestContext';

export abstract class Application {
    private _executablePath: string;
    private _container: IContainer;
    private _domain: Domain;
    public enableHystrixStream: boolean;
    private _basePath: string;
    public adapter: AbstractAdapter;

    setTestUser(user: UserContext) {
        if (!user)
            throw new Error("Test user can not be null");
        if (!user.id || !user.name || !user.scopes)
            throw new Error("Invalid test user - Properties must be set.");
        if (!DynamicConfiguration.isLocalEnvironment) {
            console.log("Warning : TestUser ignored");
            return;
        }
        this._container.injectInstance(user, DefaultServiceNames.TestUser);
    }

    onServerStarted(server: any) { }

    /**
     * Current component container
     * @returns {Container}
     */
    get container() { return this._container; }

    /**
     * Get the current domain model
     * @returns {Domain}
     */
    get domain() {
        return this._domain;
    }

    /**
     * Get the current environment
     *
     * @readonly
     */
    get environment() {
        return DynamicConfiguration.environment;
    }

    private findBasePath() {
        let parent = module.parent;
        while (parent.parent)
            parent = parent.parent;
        return Path.dirname(parent.filename);
    }

    /**
     * Create new application
     * @param path Files base path for components discovery
     * @param container Global component container
     * @param app  (optional)Server adapter
     */
    constructor(domainName?: string, container?: IContainer) {
        this._executablePath = Path.dirname(module.filename);
        this._basePath = this.findBasePath();
        this._container = container || new Container();
        this._container.injectInstance(new VulcainLogger(), DefaultServiceNames.Logger);
        this._container.injectTransient(MemoryProvider, DefaultServiceNames.Provider);
        this._container.injectInstance(this, DefaultServiceNames.Application);

        domainName = domainName || process.env.VULCAIN_DOMAIN;
        if (!domainName)
            throw new Error("Domain name is required.");

        this._domain = new Domain(domainName, this._container);
        this._container.injectInstance(this.domain, DefaultServiceNames.Domain);
    }

    private startHystrixStream() {
        if (!this.enableHystrixStream)
            return;

        this.adapter.useMiddleware("get", Conventions.defaultHystrixPath, (request, response) => {
            response.append('Content-Type', 'text/event-stream;charset=UTF-8');
            response.append('Cache-Control', 'no-cache, no-store, max-age=0, must-revalidate');
            response.append('Pragma', 'no-cache');
            console.log("get hystrix.stream");

            let subscription = hystrixStream.toObservable().subscribe(
                function onNext(sseData) {
                    response.write('data: ' + sseData + '\n\n');
                },
                function onError(error) {
                    console.log("hystrixstream: error");
                },
                function onComplete() {
                    console.log("end hystrix.stream");
                    return response.end();
                }
            );
            request.on("close", () => {
                console.log("close hystrix.stream");
                subscription.dispose();
            })

            return subscription;
        });
    }

    protected initializeDefaultServices(container: IContainer) {
    }

    protected initializeServices(container: IContainer) {
    }

    protected initializeServerAdapter(abstractAdapter: AbstractAdapter) {
    }

    abstract runAsync();

    start(port: number) {
        this.initializeDefaultServices(this.container);

        let local = new LocalAdapter();
        let eventBus = this.container.get<IEventBusAdapter>(DefaultServiceNames.EventBusAdapter, true);
        if (!eventBus) {
            this.container.injectInstance(local, DefaultServiceNames.EventBusAdapter);
            eventBus = local;
        }
        let commandBus = this.container.get<ICommandBusAdapter>(DefaultServiceNames.ActionBusAdapter, true);
        if (!commandBus) {
            this.container.injectInstance(local, DefaultServiceNames.ActionBusAdapter);
            commandBus = local;
        }

        eventBus.startAsync().then(() => {
            commandBus.startAsync().then(() => {
                try {
                    this.registerModelsInternal()
                    this.registerServicesInternal();
                    this.registerHandlersInternal();

                    this.initializeServices(this.container);

                    Preloader.runPreloads(this.container, this._domain);

                    this.adapter = this.container.get<AbstractAdapter>(DefaultServiceNames.ServerAdapter, true);
                    if (!this.adapter) {
                        this.adapter = new ExpressAdapter(this.domain.name, this._container, this);
                        this.container.injectInstance(this.adapter, DefaultServiceNames.ServerAdapter);
                        this.initializeServerAdapter(this.adapter);
                    }
                    this.startHystrixStream()
                    this.adapter.start(port);
                }
                catch (err) {
                    console.log(err);
                }
            });
        });
    }

    private registerModelsInternal() {
        this.registerModels(Path.join(this._executablePath, "defaults/models"));

        let path = Conventions.defaultModelsFolderPattern.replace("${base}", Conventions.defaultApplicationFolder);
        this.registerModels(Path.join(this._basePath, path));
    }

    protected injectFrom(path: string) {
        if(!Path.isAbsolute(path))
            path = Path.join(this._basePath, path);
        this._container.injectFrom(path);
        return this._container;
    }

    /**
     * Discover models components
     * @param path Where to find models component relative to base path (default=/api/models)
     * @returns {Container}
     */
    private registerModels(path: string) {
        if(!Path.isAbsolute(path))
            path = Path.join(this._basePath, path);
        Files.traverse(path);

        return this._container;
    }

    private registerHandlersInternal() {
        this.registerHandlers(Path.join(this._executablePath, "defaults/handlers"));

        let path = Conventions.defaultHandlersFolderPattern.replace("${base}", Conventions.defaultApplicationFolder);
        this.registerHandlers(Path.join(this._basePath, path));
    }

    /**
     * Discover models components
     * @param path Where to find models component relative to base path (default=/api/models)
     * @returns {Container}
     */
    private registerHandlers(path: string) {
        if(!Path.isAbsolute(path))
            path = Path.join(this._basePath, path);
        Files.traverse(path);
        return this._container;
    }

    private registerServicesInternal() {
        this.registerServices(Path.join(this._executablePath, "defaults/services"));

        let path = Conventions.defaultServicesFolderPattern.replace("${base}", Conventions.defaultApplicationFolder);
        this.registerServices(Path.join(this._basePath, path));
    }

    /**
     * Discover service components
     * @param path Where to find services component relative to base path (default=/core/services)
     * @returns {Container}
     */
    private registerServices(path: string) {
        if(!Path.isAbsolute(path))
            path = Path.join(this._basePath, path);

        Files.traverse(path);

        return this._container;
    }
}
