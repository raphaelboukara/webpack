/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const BinaryMiddleware = require("../serialization/BinaryMiddleware");
const FileMiddleware = require("../serialization/FileMiddleware");
const ObjectMiddleware = require("../serialization/ObjectMiddleware");
const Serializer = require("../serialization/Serializer");

const CachedSource = require("webpack-sources").CachedSource;
const RawSource = require("webpack-sources").RawSource;
const SourceMapSource = require("webpack-sources").SourceMapSource;

const serializer = new Serializer([
	new ObjectMiddleware(),
	new BinaryMiddleware(),
	new FileMiddleware()
]);

ObjectMiddleware.registerGlobal(
	CachedSource,
	"webpack-source/CachedSource",
	new class CachedSourceSerializer {
		/**
		 * @param {CachedSource} source the cached source to be serialized
		 * @param {ObjectMiddleware.ObjectSerializerContext} context context
		 * @returns {void}
		 */
		serialize(source, { write }) {
			const data = source.sourceWithMap();
			write(data.source);
			write(JSON.stringify(data.map));
		}

		/**
		 * @param {ObjectMiddleware.ObjectDeserializerContext} context context
		 * @returns {void}
		 */
		deserialize({ read }) {
			const source = read();
			const map = read();
			return new CachedSource(new SourceMapSource(source, "unknown", map));
		}
	}()
);

ObjectMiddleware.registerGlobal(
	RawSource,
	"webpack-source/RawSource",
	new class RawSourceSerializer {
		/**
		 * @param {Raw} source the raw source to be serialized
		 * @param {ObjectMiddleware.ObjectSerializerContext} context context
		 * @returns {void}
		 */
		serialize(source, { write }) {
			const data = source.source();
			write(data);
		}

		/**
		 * @param {ObjectMiddleware.ObjectDeserializerContext} context context
		 * @returns {void}
		 */
		deserialize({ read }) {
			const source = read();
			return new RawSource(source);
		}
	}()
);

module.exports = serializer;
