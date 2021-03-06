import {DynamicProperties as DP} from './properties/dynamicProperties';
import {IDynamicProperty} from './dynamicProperty';
import { ConfigurationSourceBuilder } from './configurationSources/configurationSourceBuilder';
import { Conventions } from '../utils/conventions';
import { System } from './globals/system';

/**
 *
* Provides dynamic properties updated when config change.
* Accessing a dynamic property is very fast. The last value is cached and updated on the fly
* from a <b>ConfigurationSource</b> at fixed interval.
* Updates are made using polling requests on a list of sources.
* <p>
* Dynamic properties are read only. You can set a value but it will be valid only as a default value.
* </p>
* <code>
* DynamicConfiguration.init().addRest("http....").startPollingAsync();
* let i:number = DynamicConfiguration.getProperty("prop1");
* let i2:number = DynamicConfiguration.getOrDefaultProperty("prop1", 1);
* </code>
*/
export class DynamicConfiguration
{
    /**
     * subscribe on a property changed
     */
     static onPropertyChanged<T>( handler: (e:IDynamicProperty<T>)=>void, propertyName?:string)
     {
         if( propertyName) {
             let prop = DP.instance.getProperty(propertyName);
             if(!prop) throw new Error("Property not found : " + propertyName);
             prop.propertyChanged.subscribe(handler);
         }
         else
            DP.instance.propertyChanged.subscribe(handler);
     }

     /**
      * Create a chained property
      *
      */
     static asChainedProperty<T>(defaultValue:T, name:string, ...fallbackPropertyNames:Array<string>) : IDynamicProperty<T>
     {
         return DP.factory.asChainedProperty<T>(defaultValue, name, fallbackPropertyNames);
     }

     /**
      * Create a new property
      */
     static asProperty<T>(value:T, name?:string) : IDynamicProperty<T>
     {
         let prop = DP.factory.asProperty<T>( value, name);
         return prop;
     }

     /**
      * Get a property value by name
      *
      * @static
      * @template T
      * @param {string} name
      * @returns
      *
      * @memberOf DynamicConfiguration
      */
     static getPropertyValue<T>(name:string) {
         let p = DynamicConfiguration.getProperty(name);
         return p && <T>p.value;
     }

     /**
      * Get a dynamic property
      */
     static getProperty<T>(name:string) : IDynamicProperty<T> {
         let prop = DP.instance.getProperty(name);
         return prop;
     }

     /**
      * Get or create a dynamic property
      * defaultValue can be a value or a factory
      */
     static getOrCreateProperty<T>( name:string, defaultValue: T ) : IDynamicProperty<T> {
        let prop = this.getProperty<T>( name );
        if( prop )
            return prop;

        return  DP.factory.asProperty<T>( defaultValue, name, true);

     }

     /**
      * Update a property value or create a new one if not exists
      */
     static setOrCreateProperty<T>( name:string, defaultValue: T ) : IDynamicProperty<T> {

        let prop = this.getProperty<T>( name );
        if( !prop )
        {
            prop = DP.factory.asProperty<T>( defaultValue, name, true);
        }
        else
        {
            prop.set(defaultValue);
        }
        return prop;
     }

     /**
      * Init polling informations. This function can be call only once before any use of a dynamic property.
      */
     static init( pollingIntervalInSeconds?:number, sourceTimeoutInMs?:number ): ConfigurationSourceBuilder {
         return DP.init(pollingIntervalInSeconds, sourceTimeoutInMs);
     }

     static reset( pollingIntervalInSeconds?:number, sourceTimeoutInMs?:number ) {
         return DP.instance.reset(pollingIntervalInSeconds, sourceTimeoutInMs);
     }

     /**
      * Get the underlying dynamic properties manager instance
      */
     static get instance() {
         return DP.instance;
     }
}