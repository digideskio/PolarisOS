// @flow

const _ = require('lodash');
const Utils = require('../../utils/utils');
const Logger = require('../../../logger');

/**
 * Format a given object using func.
 *
 * @private
 * @param object - Object to format
 * @param func - Formatting function
 * @param key - Path to access the field in object
 */
async function formatting(object: Object, func: Function, key: string, extra_info: ?Object) {
    const path = key.split('.');
    const last = path[path.length - 1];
    const results = [...Utils.find_popvalue_with_path(object, path)];
    const outer_objects = [...Utils.find_popvalue_with_path(object, path, true)];
    if (results.length > 0) {
        for (const i in results) {
            const result = results[i];
            const outer_object = outer_objects[i];
            outer_object[last] = await func(result, object, key, extra_info);
        }
    }
    return object;
}

/**
 * Formatting field of an object using a array of formatters
 *
 * @param object - Object to format
 * @param formatters : Array of formatters
 * @returns formatted object
 */
async function format(object: Object, formatters: Array<any>, extra_info: ?Object): Object {
    for (const formatter of formatters) {
        const promises = _.map(formatter,
            (func: Function, key: string) => formatting(object, func, key, extra_info));
        await Promise.all(promises);
    }
    return object;
}

module.exports = format;
