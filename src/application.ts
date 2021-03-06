import { Preloader } from './preloader'; // always on first line

import { HystrixSSEStream as hystrixStream } from './commands/http/hystrixSSEStream';
import { IActionBusAdapter, IEventBusAdapter } from './bus/busAdapter';
import { LocalAdapter } from './bus/localAdapter';
import * as Path from 'path';
import { Domain } from './schemas/schema';
import { Container } from './di/containers';
import { Files } from './utils/files';
import { ExpressAdapter } from './servers/express/expressAdapter';
import 'reflect-metadata';
import { DefaultServiceNames } from './di/annotations';
import { IContainer } from "./di/resolvers";
import { AbstractAdapter } from './servers/abstractAdapter';
import { Conventions } from './utils/conventions';
import { MemoryProvider } from "./providers/memory/provider";
import { UserContext, RequestContext } from './servers/requestContext';
import './defaults/serviceExplorer'; // Don't remove (auto register)
import './defaults/dependencyExplorer'; // Don't remove (auto register)
import './pipeline/scopeDescriptors';  // Don't remove (auto register)
import { ServiceDescriptors } from './pipeline/serviceDescriptions';
import { System } from './configurations/globals/system';
import { ScopesDescriptor } from './pipeline/scopeDescriptors';
import { ApiKeyService } from './defaults/services/apiKeyService';
import { LifeTime } from "./di/annotations";
import { MetricsWrapper } from "./metrics/metricsWrapper";
import { ZipkinInstrumentation } from "./metrics/zipkinInstrumentation";

/**
 * Application base class
 *
 * @export
 * @abstract
 * @class Application
 */
export class Application {
    private _executablePath: string;
    private _container: IContainer;
    private _domain: Domain;
    /**
     * Enable hystrix metrics available from /hystrix.stream
     *
     * @type {boolean}
     * @memberOf Application
     */
    public enableHystrixStream: boolean;

    private _basePath: string;
    /**
     *
     *
     * @type {AbstractAdapter}
     * @memberOf Application
     */
    public adapter: AbstractAdapter;

    /**
     * Enable api key authentication
     *
     * @param {string} apiKeyServiceName Vulcain service name
     * @param {string} [version="1.0"] Service version
     *
     * @memberOf Application
     */
    enableApiKeyAuthentication(apiKeyServiceName: string, version = "1.0") {
        this.container.injectScoped(ApiKeyService, DefaultServiceNames.ApiKeyService, apiKeyServiceName, version);
    }

    /**
     * Called when the server adapter is started
     *
     * @param {*} server
     * @param {*} adapter
     *
     * @memberOf Application
     */
    onServerStarted(server: any, adapter: any) { }

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

    private findBasePath() {
        let parent = module.parent;
        while (parent.parent) {
            parent = parent.parent;
        }
        return Path.dirname(parent.filename);
    }

    /**
     * Create new application
     * @param path Files base path for components discovery
     * @param container Global component container
     * @param app  (optional)Server adapter
     */
    constructor(domainName?: string, container?: IContainer) {
        domainName = domainName;
        if (!domainName) {
            throw new Error("Domain name is required.");
        }
        System.defaultDomainName = domainName;

        System.log.info(null, ()=>"Starting application");

        this._executablePath = Path.dirname(module.filename);
        this._basePath = this.findBasePath();

        // Ensure initializing this first
        const test = System.isDevelopment;

        this._container = container || new Container();
        this._container.injectInstance(this, DefaultServiceNames.Application);

        this._domain = new Domain(domainName, this._container);
        this._container.injectInstance(this._domain, DefaultServiceNames.Domain);
    }

    private startHystrixStream() {
        if (!this.enableHystrixStream) {
            return;
        }

        this.adapter.useMiddleware("get", Conventions.instance.defaultHystrixPath, (request, response) => {
            response.append('Content-Type', 'text/event-stream;charset=UTF-8');
            response.append('Cache-Control', 'no-cache, no-store, max-age=0, must-revalidate');
            response.append('Pragma', 'no-cache');
            System.log.info(null, ()=>"get hystrix.stream");

            let subscription = hystrixStream.toObservable().subscribe(
                function onNext(sseData) {
                    response.write('data: ' + sseData + '\n\n');
                },
                function onError(error) {
                    System.log.info(null, ()=>"hystrixstream: error");
                },
                function onComplete() {
                    System.log.info(null, ()=>"end hystrix.stream");
                    return response.end();
                }
            );
            request.on("close", () => {
                System.log.info(null, ()=> "close hystrix.stream");
                subscription.unsubscribe();
            });

            return subscription;
        });
    }

    /**
     * Define all scopes used in this service
     *
     * @protected
     * @param {ScopesDescriptor} scopes Scope definitions manager - Use scopes.defineScope for each scope
     *
     * @memberOf Application
     */
    protected defineScopes(scopes: ScopesDescriptor) {

    }

    /**
     * Override this method to initialize default containers
     *
     * @protected
     * @param {IContainer} container
     */
    protected initializeDefaultServices(container: IContainer) {
    }

    /**
     * Override this method to add your custom services
     *
     * @protected
     * @param {IContainer} container
     */
    protected initializeServices(container: IContainer) {
    }

    /**
     * Called before the server adapter is started
     *
     * @protected
     * @param {AbstractAdapter} abstractAdapter
     */
    protected initializeServerAdapter(abstractAdapter: AbstractAdapter) {
    }

    /**
     * Initialize and start application
     *
     * @param {number} port
     */
    async start(port: number) {
        try {
            this.initializeDefaultServices(this.container);

            let local = new LocalAdapter();
            let eventBus = this.container.get<IEventBusAdapter>(DefaultServiceNames.EventBusAdapter, true);
            if (!eventBus) {
                this.container.injectInstance(local, DefaultServiceNames.EventBusAdapter);
                eventBus = local;
            }
            let commandBus = this.container.get<IActionBusAdapter>(DefaultServiceNames.ActionBusAdapter, true);
            if (!commandBus) {
                this.container.injectInstance(local, DefaultServiceNames.ActionBusAdapter);
                commandBus = local;
            }

            await eventBus.startAsync();
            await commandBus.startAsync();

            this.registerComponents();
            this.initializeServices(this.container);
            Preloader.instance.runPreloads(this.container, this._domain);

            let scopes = this.container.get<ScopesDescriptor>(DefaultServiceNames.ScopesDescriptor);
            this.defineScopes(scopes);

            let descriptors = this.container.get<ServiceDescriptors>(DefaultServiceNames.ServiceDescriptors);
            descriptors.createHandlersTable();

            // Ensures metrics are initialized before creating adapter
            // because metrics can declare endpoints (e.g promotheus)
            if(this.container.get(DefaultServiceNames.Metrics, true) === null) {
                this.container.injectInstance(new MetricsWrapper(this.container), DefaultServiceNames.Metrics);
            }
            if(this.container.get(DefaultServiceNames.RequestTracer, true) === null) {
                this.container.injectSingleton(ZipkinInstrumentation, DefaultServiceNames.RequestTracer);
            }

            this.adapter = this.container.get<AbstractAdapter>(DefaultServiceNames.ServerAdapter, true);
            if (!this.adapter) {
                this.adapter = new ExpressAdapter(this.domain.name, this._container, this);
                this.container.injectInstance(this.adapter, DefaultServiceNames.ServerAdapter);
                this.initializeServerAdapter(this.adapter);
                this.adapter.initialize();
            }
            this.startHystrixStream();
            this.adapter.start(port);
        }
        catch (err) {
            System.log.error(null, err, ()=>"ERROR when starting application");
            process.exit(2);
        }
    }

    private registerComponents() {
        this.registerRecursive(Path.join(this._executablePath, "defaults/models"));
        this.registerRecursive(Path.join(this._executablePath, "defaults/handlers"));
        this.registerRecursive(Path.join(this._executablePath, "defaults/services"));

        let path = Conventions.instance.defaultApplicationFolder;
        this.registerRecursive(Path.join(this._basePath, path));
    }

    /**
     * Discover models components
     * @param path Where to find models component relative to base path (default=/api/models)
     * @returns {Container}
     */
    private registerRecursive(path: string) {
        if (!Path.isAbsolute(path)) {
            path = Path.join(this._basePath, path);
        }
        Files.traverse(path);

        return this._container;
    }

    /**
     * Inject all components from a specific folder (relative to the current folder)
     *
     * @protected
     * @param {string} path Folder path
     * @returns The current container
     */
    protected injectFrom(path: string) {
        if (!Path.isAbsolute(path)) {
            path = Path.join(this._basePath, path);
        }
        this._container.injectFrom(path);
        return this._container;
    }
}

export class ApplicationBuilder {
    private app: Application;

    constructor(domain: string) {
        this.app = new Application(domain);
    }

    public useMongo(address?: string) {
        this.app.container.useMongoProvider(address);
        return this;
    }

    public enableHystrixStream() {
        this.app.enableHystrixStream = true;
        return this;
    }

    enableApiKeyAuthentication(apiKeyServiceName: string, version = "1.0") {
        this.app.enableApiKeyAuthentication(apiKeyServiceName, version);
        return this;
    }

     protected useService(name: string, service: Function, lifeTime?: LifeTime) {
        this.app.container.inject(name, service, lifeTime);
        return this;
    }

    runAsync(port = 8080) {
        return this.app.start(port);
    }
}