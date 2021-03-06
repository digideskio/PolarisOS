// @flow
const ODM = require('../crud/odm');
const Joi = require('joi');
const Handlebars = require('../../utils/templating');
const Utils = require('../../utils/utils');
const FormatFunctions = require('../../pipeline/formatter/formatfunctions');
const ComplFunctions = require('../../pipeline/completer/complfunctions');
const TransFunctions = require('../../pipeline/transformer/transfunctions');
const MMapping = require('../crud/mapping');

class Pipeline extends ODM {
    static _recover_value(value: string, type: string): ?number | ?boolean | ?string | ?Object {
        if (value === '__null') {
            return null;
        } else if (value === '__undefined') {
            return undefined;
        } else if (value === '{}') {
            return {};
        } else if (value === '__empty_string') {
            return '';
        }

        switch (type) {
        default:
        case 'string':
            return value;
        case 'boolean': {
            if (typeof value === 'boolean') {
                return value;
            }
            const v = value.toLowerCase();
            return (v === 'yes' || v === 'true');
        }
        case 'integer':
            return parseInt(value, 10);
        case 'hexadecimal':
            return parseInt(value, 16);
        case 'double':
            return parseFloat(value);
        }
    }

    static async generate_resetters(source: Object): Promise<Object> {
        if ('resetters' in source) {
            return source.resetters.reduce((obj, d) => {
                if (d.value != null && d.key != null) {
                    const t = Handlebars.compile(d.value)({});
                    let myobj = t;
                    try { myobj = JSON.parse(t); } catch (err) {}

                    const small = Utils.make_nested_object_from_path(d.key.split('.'), myobj);
                    obj = Utils.merge_with_replacement(obj, small);
                }
                return obj;
            }, {});
        }
        return {};
    }

    static async generate_filters(source: Object): Promise<Array<string>> {
        if ('filters' in source) {
            return source.filters
                .filter(f => (f != null && f.value && f.value != null))
                .map(f => f.value);
        }
        return [];
    }

    static async generate_defaults(source: Object): Promise<Object> {
        const info = source;
        if ('defaults' in info) {
            return info.defaults.reduce((obj, d) => {
                if (d.value != null && d.key != null) {
                    const t = Handlebars.compile(d.value)({});
                    const small = Utils.make_nested_object_from_path(d.key, t);
                    obj = Utils.merge_with_replacement(obj, small);
                }
                return obj;
            }, {});
        }
        return {};
    }

    static async generate_formatters(source: Object): Promise<Array<any>> {
        const info = source;
        if ('formatters' in info && info.formatters.length > 0) {
            return info.formatters.map((f) => {
                if (f.function.arguments) {
                    f.function.arguments = f.function.arguments.map((arg) => {
                        arg.value = Pipeline._recover_value(arg.value, arg.type);
                        return arg;
                    });
                }

                const args = f.function.arguments;
                switch (f.function.name) {
                case 'oarray_to_array':
                    return { [f.field]: a => FormatFunctions.oarray_to_array(a) };
                case 'filter_empty_or_null_objects':
                    return { [f.field]: FormatFunctions.filter_empty_or_null_objects };
                case 'format_string':
                    return { [f.field]: a => FormatFunctions.format_string(args[0].value)(a) };
                case 'generic_formatter':
                    return { [f.field]: (a, o, k) => FormatFunctions.generic_formatter(args[0].value)(a, o, k) };
                default:
                    return null;
                }
            }).filter(f => f != null);
        }
        return [];
    }

    static async generate_completers(source: Object): Promise<Array<any>> {
        const info = source;
        if ('completers' in info && info.completers.length > 0) {
            return info.completers.map((f) => {
                if (f.function.arguments) {
                    f.function.arguments = f.function.arguments.map((arg) => {
                        arg.value = Pipeline._recover_value(arg.value, arg.type);
                        return arg;
                    });
                }

                const args = f.function.arguments;
                switch (f.function.name) {
                case 'generic_complete':
                    return { [f.field]: (o, p, i) => ComplFunctions.generic_complete(args[0].value)(o, p, i) };
                case 'key_complete':
                    return { [f.field]: (o, p, i) => ComplFunctions.key_complete(o, p, i) };
                case 'secret_complete':
                    return { [f.field]: (o, p, i) => ComplFunctions.secret_complete(o, p, i) };
                case 'denormalization':
                    return { [f.field]: (o, p, i) =>
                        ComplFunctions.denormalization(args[0].value, args[1].value,
                            args[2].value, args[3].value, args[4].value)(o, p, i),
                    };
                case 'initial':
                    return { [f.field]: (o, p, i) =>
                        ComplFunctions.initial(args[0].value, args[1].value)(o, p, i),
                    };
                default:
                    return null;
                }
            }).filter(f => f != null);
        }
        return [];
    }

    static async generate_transformers(source: Object): Promise<Array<any>> {
        const info = source;
        if (!('transformers' in info)) {
            return [];
        }

        if (info.transformers.length === 0) {
            return [];
        }

        return info.transformers.map((f) => {
            switch (f.function.name) {
            default:
                return null;
            }
        }).filter(f => f != null);
    }

    static async generate_validators(source: Object): Promise<Array<any>> {
        const info = source;
        const validators = [];
        if ('validators' in info && info.validators.length > 0) {
            const partitions = info.validators.reduce((obj, v) => {
                if (v.type === 'function') {
                    obj.functions.push(v);
                } else {
                    obj.joi.push(v);
                }
                return obj;
            }, { joi: [], functions: [] });

            validators.push(Joi.object(partitions.joi.reduce((obj, v) => {
                switch (v.type) {
                default:
                case 'string':
                    obj[v.field] = Joi.string();
                    break;
                }

                if (v.required) {
                    obj[v.field] = obj[v.field].required();
                } else {
                    obj[v.field] = obj[v.field].optional().empty('');
                }
                return obj;
            }, {})));
        }
        return validators;
    }

    static async generate_model(index: string, type: string,
        client: Object, pipelines: Array<Object>): Object {
        // console.log('gen model', index, type);
        const mapping = await Pipeline.fetch_mapping(index, type, client);


        const all_pipelines = [];
        for (const pipeline of pipelines) {
            const defaults = await Pipeline.generate_defaults(pipeline.source);
            const filters = await Pipeline.generate_filters(pipeline.source);
            const resetters = await Pipeline.generate_resetters(pipeline.source);
            const formatters = await Pipeline.generate_formatters(pipeline.source);
            const completers = await Pipeline.generate_completers(pipeline.source);
            const validators = await Pipeline.generate_validators(pipeline.source);
            const transformers = await Pipeline.generate_transformers(pipeline.source);
            all_pipelines.push({
                Validation: validators,
                Formatting: formatters,
                Completion: completers,
                Transforming: transformers,
                Filtering: filters,
                Resetting: resetters,
                Defaults: defaults,
            });
        }

        const pipe = {
            RawMapping: mapping,
            Mapping: new MMapping(mapping),
            Messages: {
                set: `l_message_set_entity_${type}`,
                remove: `l_message_remove_entity_${type}`,
                modify: `l_message_modify_entity_${type}`,
            },
            Pipelines: all_pipelines,
            Name: type,
        };
        return pipe;
    }
}

module.exports = Pipeline;
