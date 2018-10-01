/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/

"use strict";

const PlainObjectSerializer = require("./PlainObjectSerializer");
const SerializerMiddleware = require("./SerializerMiddleware");

/*

Format:

File -> Section*
Section -> ObjectSection | ReferenceSection | EscapeSection | OtherSection

ObjectSection -> ESC (
	null |
	string:request (string|null):export
) Section:value*
ReferenceSection -> ESC number:relativeOffset
EscapeSection -> ESC 1 (escaped value ESC)
OtherSection -> any (except ESC)

Why using null as escape value?
Multiple null values can merged by the BinaryMiddleware, which makes it very efficient
Technically any value can be used.

*/

/**
 * @typedef {Object} ObjectSerializerContext
 * @property {function(any): void} write
 */

/**
 * @typedef {Object} ObjectDeserializerContext
 * @property {function(): any} read
 */

/**
 * @typedef {Object} ObjectSerializer
 * @property {function(any, ObjectSerializerContext): void} serialize
 * @property {function(ObjectDeserializerContext): any} deserialize
 */

const ESCAPE = null;
const ESCAPE_ESCAPE_VALUE = 1;
const GLOBAL_SERIALIZER_REQUEST = null;

const plainObjectSerializer = new PlainObjectSerializer();

const serializers = new Map();
const globalSerializers = new Map();

serializers.set(Object, {
	request: GLOBAL_SERIALIZER_REQUEST,
	exportName: null,
	serializer: plainObjectSerializer
});
serializers.set(Array, {
	request: GLOBAL_SERIALIZER_REQUEST,
	exportName: null,
	serializer: plainObjectSerializer
});
globalSerializers.set(null, plainObjectSerializer);

class ObjectMiddleware extends SerializerMiddleware {
	/**
	 * @param {new (...params: any[]) => any} Constructor
	 * @param {string} request
	 * @param {string} exportName
	 * @param {ObjectSerializer} serializer
	 * @returns {void}
	 */
	static register(Constructor, request, exportName, serializer) {
		if (request === GLOBAL_SERIALIZER_REQUEST) {
			if (globalSerializers.has(exportName)) {
				throw new Error(
					`ObjectMiddleware.register: global serializer with this name (${exportName}) is already registered`
				);
			}
			globalSerializers.set(exportName, serializer);
		}
		serializers.set(Constructor, {
			request,
			exportName,
			serializer
		});
	}

	/**
	 * @param {new (...params: any[]) => any} Constructor
	 * @param {string} name
	 * @param {ObjectSerializer} serializer
	 * @returns {void}
	 */
	static registerGlobal(Constructor, name, serializer) {
		ObjectMiddleware.register(
			Constructor,
			GLOBAL_SERIALIZER_REQUEST,
			name,
			serializer
		);
	}

	static getSerializerFor(object) {
		const c = object.constructor;
		const config = serializers.get(c);
		if (!config) throw new Error(`No serializer registered for ${c.name}`);
		return config;
	}

	_handleFunctionSerialization(fn, context) {
		return () => {
			const r = fn();
			if (r instanceof Promise)
				return r.then(data => this.serialize(data, context));
			return this.serialize(r, context);
		};
	}

	_handleFunctionDeserialization(fn, context) {
		return () => {
			const r = fn();
			if (r instanceof Promise)
				return r.then(data => this.deserialize(data, context));
			return this.deserialize(r, context);
		};
	}

	/**
	 * @param {any[]} data data items
	 * @param {TODO} context
	 * @returns {any[]|Promise<any[]>} serialized data
	 */
	serialize(data, context) {
		const result = [];
		let currentPos = 0;
		const referenceable = new Map();
		const addReferenceable = item => {
			referenceable.set(item, currentPos++);
		};
		const process = item => {
			const ref = referenceable.get(item);
			if (ref !== undefined) {
				result.push(ESCAPE, ref - currentPos);
				return;
			}
			if (typeof item === "object" && item !== null) {
				const {
					request,
					exportName,
					serializer
				} = ObjectMiddleware.getSerializerFor(item);

				result.push(ESCAPE, request, exportName);
				serializer.serialize(item, {
					write(value) {
						process(value);
					}
				});
				addReferenceable(item);
			} else if (typeof item === "string") {
				addReferenceable(item);
				result.push(item);
			} else if (Buffer.isBuffer(item)) {
				addReferenceable(item);
				result.push(item);
			} else if (item === ESCAPE) {
				result.push(ESCAPE, ESCAPE_ESCAPE_VALUE);
			} else if (typeof item === "function") {
				result.push(this._handleFunctionSerialization(item));
			} else {
				result.push(item);
			}
		};
		for (const item of data) {
			process(item);
		}
		return result;
	}

	/**
	 * @param {any[]} data data items
	 * @param {TODO} context
	 * @returns {any[]|Promise<any[]>} deserialized data
	 */
	deserialize(data, context) {
		let currentDataPos = 0;
		const read = () => {
			if (currentDataPos >= data.length)
				throw new Error("Unexpected end of stream");
			return data[currentDataPos++];
		};
		let currentPos = 0;
		const referenceable = new Map();
		const addReferenceable = item => {
			referenceable.set(currentPos++, item);
		};
		const result = [];
		const decodeValue = () => {
			const item = read();
			if (item === ESCAPE) {
				const nextItem = read();
				if (nextItem === ESCAPE_ESCAPE_VALUE) {
					return ESCAPE;
				} else if (typeof nextItem === "number") {
					// relative reference
					return referenceable.get(currentPos + nextItem);
				} else {
					const request = nextItem;
					const exportName = read();
					let serializer;
					if (request === GLOBAL_SERIALIZER_REQUEST) {
						serializer = globalSerializers.get(exportName);
					} else {
						let requestValue = require(request);
						if (exportName) {
							requestValue = requestValue[exportName];
						}
						const config = serializers.get(requestValue);
						if (config === undefined) {
							throw new Error(
								`No deserializer registered for ${requestValue.name}`
							);
						}
						serializer = config.serializer;
					}
					const item = serializer.deserialize({
						read() {
							const item = decodeValue();
							return item;
						}
					});
					addReferenceable(item);
					return item;
				}
			} else if (typeof item === "string") {
				addReferenceable(item);
				return item;
			} else if (Buffer.isBuffer(item)) {
				addReferenceable(item);
				return item;
			} else if (typeof item === "function") {
				return this._handleFunctionDeserialization(item, context);
			} else {
				return item;
			}
		};
		while (currentDataPos < data.length) {
			result.push(decodeValue());
		}
		return result;
	}
}

module.exports = ObjectMiddleware;
