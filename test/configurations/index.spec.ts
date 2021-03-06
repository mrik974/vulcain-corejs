import { DynamicProperties } from '../../dist/configurations/properties/dynamicProperties';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { DynamicConfiguration } from '../../dist/configurations/dynamicConfiguration';
import { MemoryConfigurationSource } from '../../dist/configurations/configurationSources/memoryConfigurationSource';
import { DynamicProperty } from '../../src/configurations/properties/dynamicProperty';

describe('DynamicConfiguration', function () {

    beforeEach(function () {
        DynamicConfiguration.instance.reset(1);
    });

    it('should have default values', function () {

        expect(DynamicConfiguration.getProperty("test")).to.be.undefined;
        let p = DynamicConfiguration.getOrCreateProperty("test", 10);
        expect(p.value).to.equal(10);
    });

    it('should create property', function () {

        let prop = DynamicConfiguration.asProperty(10, "test");
        expect(prop).not.to.be.null;
        expect(10).to.be.equal(prop.value);
        let p = DynamicConfiguration.getOrCreateProperty("test", 0);
        expect(10).to.equal(p.value);
        let prop2 = DynamicConfiguration.getProperty("test");
        expect(prop2).not.to.be.null;
        expect(prop.value).to.equal(prop2.value);
    });

    it('should thrown on duplicate property', function () {

        let prop = DynamicConfiguration.asProperty(10, "test");
        expect(() => {
            let prop2 = DynamicConfiguration.asProperty(10, "test");
        }
        ).to.throw();
    });

    it('should raise changed event', () => {

        let cx = 0;
        DynamicProperties.instance.reset();
        DynamicProperties.instance.propertyChanged
            .filter( p => p.name === "test")
            .subscribe((property) => {
                cx += property.value;
            });

        let prop = DynamicConfiguration.asProperty(10, "test");
        prop.set(15);
        let prop2 = DynamicConfiguration.asProperty(10, "test2");
        prop.set(20);

        expect(10 + 15 + 20).to.equal(cx);
        expect(20).to.equal(prop.value);
    });

    it('should support different types', function () {
        expect(10).to.equal(DynamicConfiguration.asProperty(10, "test").value);
        expect(2.0).to.equal(DynamicConfiguration.asProperty(2.0, "test2").value);
        expect("xxx").to.equal(DynamicConfiguration.asProperty("xxx", "test3").value);
        expect(true).to.equal(DynamicConfiguration.asProperty(true, "test4").value);
        let v2 = [1, 2, 3];
        expect(v2).to.equal(DynamicConfiguration.asProperty(v2, "test6").value);
    });

    it('should chain values', function () {

        let chained = DynamicConfiguration.asChainedProperty(30, "test", "test1");
        expect(30).to.equal(DynamicConfiguration.asChainedProperty(30, "test", "test1").value);

        let prop2 = DynamicConfiguration.asProperty(20, "test1");
        expect(20).to.equal(chained.value);

        chained.set(40);
        prop2.set(25);
        expect(40).to.equal(chained.value);

        let prop = DynamicConfiguration.asProperty(10, "test");
        expect(10).to.equal(chained.value);

        expect(25).to.equal(DynamicConfiguration.asChainedProperty(30, "??", "test1").value);
        expect(40).to.equal(DynamicConfiguration.asChainedProperty(40, "??", "???").value);
    });

    it('should refresh new values', async function () {

        let source = new MemoryConfigurationSource();
        await DynamicConfiguration.instance.startPollingAsync(source);

        let prop = DynamicConfiguration.instance.getProperty("test");
        expect(prop).to.be.undefined;

        source.set("test", 10);
        prop = DynamicConfiguration.instance.getProperty("test");
        expect(prop).to.be.undefined;

        await DynamicConfiguration.instance.startPollingAsync(); // Force polling

        prop = DynamicConfiguration.instance.getProperty("test");
        expect(prop).not.to.be.undefined;
        expect(10).to.equal(prop.value);
    });

    it('should refresh new chained values', async function () {

            let source = new MemoryConfigurationSource();
            await DynamicConfiguration.instance.startPollingAsync(source);

            let chained = DynamicConfiguration.asChainedProperty(30, "test10", "test20");
            expect(30).to.equal(DynamicConfiguration.asChainedProperty(30, "test10", "test20").value);

            source.set("test20", 20);
            await DynamicConfiguration.instance.startPollingAsync(); // Force polling

            expect(20).to.equal(chained.value);

            source.set("test10", 10);
            await DynamicConfiguration.instance.startPollingAsync(); // Force polling

            expect(10).to.equal(chained.value);

            source.set("test10", 11);
            await DynamicConfiguration.instance.startPollingAsync(); // Force polling

            expect(11).to.equal(chained.value);
    });

    it('should have memory source', async function () {

            let source1 = new MemoryConfigurationSource();
            await DynamicConfiguration.instance.startPollingAsync(source1);

            let source2 = new MemoryConfigurationSource();
            await DynamicConfiguration.instance.startPollingAsync(source2);

            let prop = DynamicConfiguration.getOrCreateProperty("test30", 0);
            expect(0).to.equal(prop.value);

            source1.set("test30", 10);
            await DynamicConfiguration.instance.startPollingAsync(); // Force polling

            expect(10).to.equal(prop.value);

            source2.set("test30", 20);
            await DynamicConfiguration.instance.startPollingAsync(); // Force polling

            expect(20).to.equal(prop.value);
    });
});
