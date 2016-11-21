import { TestContainer } from '../../dist/di/containers';
import { expect } from 'chai';
import { Model, Property, Reference, Validator } from '../../dist/schemas/annotations';
import { Domain } from '../../dist/schemas/schema';

@Model()
class BaseModel {
    @Property({ type: "string", required: true })
    @Validator("length", { min: 2 })
    baseText: string;
}

@Model({ extends: "BaseModel" })
class SimpleModel extends BaseModel {
    @Property({ type: "string", required: true })
    text: string;
    @Property({ type: "number" })
    number: number;
}

@Model()
class AggregateModel {
    @Reference({ item: "SimpleModel", cardinality: "one" })
    simple: SimpleModel;
}

let container = new TestContainer("Test");

describe("Validate data", function () {

    it("should validate base class", async () => {
        let domain = container.get<Domain>("Domain");
        let schema = domain.getSchema("SimpleModel");

        let model: SimpleModel = { text: "text", number: 1, baseText: "" };
        let errors = await schema.validateAsync(null, model);
        expect(errors.length).equals(1);
        expect(errors[0].property).equals("baseText");
    });

    it("should validate call validator", async () => {
        let domain = container.get<Domain>("Domain");
        let schema = domain.getSchema("SimpleModel");

        let model: SimpleModel = { text: "text", number: 1, baseText: "a" };
        let errors = await schema.validateAsync(null, model);
        expect(errors.length).equals(1);
        expect(errors[0].property).equals("baseText");
    });

    it("should validate malformed number", async () => {
        let domain = container.get<Domain>("Domain");
        let schema = domain.getSchema("SimpleModel");

        let model = schema.bind({ text: "text", number: "1w1", baseText: "text" });
        let errors = await schema.validateAsync(null, model);
        expect(errors.length).equals(1);
        expect(errors[0].property).equals("number");
    });

    it("should validate valid values", async () => {
        let model: SimpleModel = { text: "text", number: 1, baseText: "text" };
        let domain = container.get<Domain>("Domain");
        let schema = domain.getSchema("SimpleModel");
        let errors = await schema.validateAsync(null, model);

        expect(errors.length).equals(0);
    });
});
