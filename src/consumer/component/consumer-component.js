import path from 'path';
import fs from 'fs';
import { mkdirp, isString } from '../../utils';
import BitJson from '../bit-json';
import { Impl, Specs, Dist, License, Misc } from '../component/sources';
import ConsumerBitJson from '../bit-json/consumer-bit-json';
import Consumer from '../consumer';
import BitId from '../../bit-id/bit-id';
import Scope from '../../scope/scope';
import BitIds from '../../bit-id/bit-ids';
import docsParser, { Doclet } from '../../jsdoc/parser';
import specsRunner from '../../specs-runner';
import SpecsResults from '../specs-results';
import type { Results } from '../../specs-runner/specs-runner';
import ComponentSpecsFailed from '../exceptions/component-specs-failed';
import ComponentNotFoundInline from './exceptions/component-not-found-inline';

import {
  DEFAULT_BOX_NAME,
  DEFAULT_IMPL_NAME,
  DEFAULT_SPECS_NAME,
  DEFAULT_BIT_VERSION,
  NO_PLUGIN_TYPE,
} from '../../constants';

export type ComponentProps = {
  name: string,
  box: string,
  version?: ?number,
  scope?: ?string,
  implFile?: ?string,
  specsFile?: ?string,
  miscFiles?: ?string[],
  compilerId?: ?BitId,
  testerId?: ?BitId,
  dependencies?: ?BitIds,
  packageDependencies?: ?Object,
  impl?: ?Impl|string,
  specs?: ?Specs|string,
  misc?: ?Misc|[],
  docs?: ?Doclet[],
  dist?: ?Dist,
  specsResults?: ?SpecsResults,
  license?: ?License,
  deprecate?: ?string,
}

export default class Component {
  name: string;
  box: string;
  version: ?number;
  scope: ?string;
  implFile: string;
  specsFile: string;
  miscFiles: string[];
  compilerId: ?BitId;
  testerId: ?BitId;
  dependencies: BitIds;
  packageDependencies: Object;
  _impl: ?Impl|string;
  _specs: ?Specs|string;
  _docs: ?Doclet[];
  _misc: ?Misc|[];
  dist: ?Dist;
  specsResults: ?SpecsResults;
  license: ?License;
  deprecate: ?string;

  set impl(val: Impl) { this._impl = val; }

  get impl(): Impl {
    if (isString(this._impl)) {
      // $FlowFixMe
      this._impl = Impl.load(this._impl);
    }
    // $FlowFixMe
    return this._impl;
  }

  set specs(val: Specs) { this._specs = val; }

  get specs(): ?Specs {
    if (!this._specs) return null;

    if (isString(this._specs)) {
      // $FlowFixMe
      this._specs = Specs.load(this._specs);
    }
    // $FlowFixMe
    return this._specs;
  }

  set misc(val: Misc) { this._misc = val; }

  get misc(): ?Misc {
    if (!this._misc) return null;
    if (this._misc instanceof Misc) return this._misc;

    if (Array.isArray(this._misc)) {
      // $FlowFixMe
      this._misc = Misc.load(this._misc);
    }
    // $FlowFixMe
    return this._misc;
  }

  get id(): BitId {
    if (!this.scope || !this.version) {
      console.error(this);
      throw new Error('cant produce id because scope or version are missing');
    }

    return new BitId({
      scope: this.scope,
      box: this.box,
      name: this.name,
      version: this.version.toString(),
    });
  }

  get docs(): ?Doclet[] {
    if (!this._docs) this._docs = docsParser(this.impl.src);
    return this._docs;
  }

  constructor({
    name,
    box,
    version,
    scope,
    implFile,
    specsFile,
    miscFiles,
    compilerId,
    testerId,
    dependencies,
    packageDependencies,
    impl,
    specs,
    misc,
    docs,
    dist,
    specsResults,
    license,
    deprecate,
  }: ComponentProps) {
    this.name = name;
    this.box = box || DEFAULT_BOX_NAME;
    this.version = version;
    this.scope = scope;
    this.implFile = implFile || DEFAULT_IMPL_NAME;
    this.specsFile = specsFile || DEFAULT_SPECS_NAME;
    this.miscFiles = miscFiles || [];
    this.compilerId = compilerId;
    this.testerId = testerId;
    this.dependencies = dependencies || new BitIds();
    this.packageDependencies = packageDependencies || {};
    this._specs = specs;
    this._impl = impl;
    this._misc = misc;
    this._docs = docs;
    this.dist = dist;
    this.specsResults = specsResults;
    this.license = license;
    this.deprecate = deprecate;
  }

  writeBitJson(bitDir: string, force?:boolean = true): Promise<Component> {
    return new BitJson({
      version: this.version,
      scope: this.scope,
      impl: this.implFile,
      spec: this.specsFile,
      miscFiles: this.miscFiles,
      compiler: this.compilerId ? this.compilerId.toString() : NO_PLUGIN_TYPE,
      tester: this.testerId ? this.testerId.toString() : NO_PLUGIN_TYPE,
      dependencies: this.dependencies.toObject(),
      packageDependencies: this.packageDependencies
    }).write({ bitDir, override: force });
  }

  dependencies(): BitIds {
    return BitIds.fromObject(this.dependencies);
  }

  write(bitDir: string, withBitJson: boolean, force?: boolean = true): Promise<Component> {
    return mkdirp(bitDir)
      .then(() => this.impl.write(bitDir, this.implFile, force))
      .then(() => { return this.specs ? this.specs.write(bitDir, this.specsFile, force) : undefined; })
      .then(() => { return this.misc ? this.misc.write(bitDir, this.miscFiles, force) : undefined; })
      .then(() => { return this.dist ? this.dist.write(bitDir, this.implFile, force) : undefined; })
      .then(() => { return withBitJson ? this.writeBitJson(bitDir, force): undefined; })
      .then(() => { return this.license && this.license.src ? this.license.write(bitDir, force) : undefined; })
      .then(() => this);
  }

  runSpecs({ scope, rejectOnFailure, consumer, environment, save, verbose }: {
    scope: Scope,
    rejectOnFailure?: bool,
    consumer?: Consumer,
    environment?: ?bool,
    save?: ?bool,
    verbose?: ?bool
  }): Promise<?Results> {
    function compileIfNeeded(
      condition: bool,
      compiler: ?{ compile?: (string) => { code: string } },
      src: string): ?string {
      if (!condition || !compiler || !compiler.compile) return src;
      return compiler.compile(src).code;
    }

    const installEnvironmentsIfNeeded = (): Promise<any> => {
      if (environment) {
        return scope.installEnvironment({
          ids: [this.compilerId, this.testerId],
          consumer,
          verbose
        });
      }
      return Promise.resolve();
    };

    if (!this.testerId || !this.specs || !this.specs.src) return Promise.resolve(null);

    return installEnvironmentsIfNeeded()
    .then(() => {
      try {
        const testerFilePath = scope.loadEnvironment(
          this.testerId, { pathOnly: true, bareScope: !consumer });
        const compiler = this.compilerId ? scope.loadEnvironment(
          this.compilerId, { bareScope: !consumer }) : null;
        const implSrc = compileIfNeeded(!!this.compilerId, compiler, this.impl.src);
        // $FlowFixMe
        const specsSrc = compileIfNeeded(!!this.compilerId, compiler, this.specs.src);
        return specsRunner.run({ scope, testerFilePath, implSrc, specsSrc, testerId: this.testerId })
        .then((specsResults) => {
          this.specsResults = SpecsResults.createFromRaw(specsResults);
          if (rejectOnFailure && !this.specsResults.pass) {
            return Promise.reject(new ComponentSpecsFailed());
          }

          if (save) {
            return scope.sources.modifySpecsResults({
              source: this,
              specsResults: this.specsResults
            })
            .then(() => Promise.resolve(this.specsResults));
          }

          return Promise.resolve(this.specsResults);
        });
      } catch (e) { return Promise.reject(e); }
    });
  }

  build({ scope, environment, save, consumer, verbose }:
  { scope: Scope, environment?: ?bool, save?: ?bool, consumer?: Consumer, verbose?: ?bool }):
  Promise<{code: string, map: Object}|null> { // @TODO - write SourceMap Type
    return new Promise((resolve, reject) => {
      if (!this.compilerId) return resolve(null);
      const installEnvironmentIfNeeded = (): Promise<any> => {
        if (environment) {
          return scope.installEnvironment({
            ids: [this.compilerId],
            consumer,
            verbose,
          });
        }
        return Promise.resolve();
      };

      return installEnvironmentIfNeeded()
      .then(() => {
        const opts = { bareScope: !consumer };
        const compiler = scope.loadEnvironment(this.compilerId, opts);
        const src = this.impl.src;
        if (!compiler.compile) {
          return reject(`"${this.compilerId.toString()}" does not have a valid compiler interface`);
        }
        const { code, mappings } = compiler.compile(src); // eslint-disable-line
        this.dist = new Dist(code, mappings);

        if (save) {
          return scope.sources.updateDist({ source: this })
          .then(() => resolve(code));
        }

        return resolve(code);
      }).catch(reject);
    });
  }

  toObject(): Object {
    return {
      name: this.name,
      box: this.box,
      version: this.version ? this.version.toString() : null,
      scope: this.scope,
      implFile: this.implFile,
      specsFile: this.specsFile,
      miscFiles: this.miscFiles,
      compilerId: this.compilerId ? this.compilerId.toString() : null,
      testerId: this.testerId ? this.testerId.toString() : null,
      dependencies: this.dependencies.toObject(),
      packageDependencies: this.packageDependencies,
      specs: this.specs ? this.specs.serialize() : null,
      impl: this.impl.serialize(),
      misc: this.misc.serialize(),
      docs: this.docs,
      dist: this.dist ? this.dist.serialize() : null,
      specsResults: this.specsResults ? this.specsResults.serialize() : null,
      license: this.license ? this.license.serialize() : null,
      deprecate: this.deprecate ? this.deprecate.toString() : null
    };
  }

  toString(): string {
    return JSON.stringify(this.toObject());
  }

  static fromObject(object: Object): Component {
    const {
      name,
      box,
      version,
      scope,
      implFile,
      specsFile,
      miscFiles,
      compilerId,
      testerId,
      dependencies,
      packageDependencies,
      impl,
      specs,
      docs,
      dist,
      misc,
      specsResults,
      license,
      deprecate
    } = object;

    return new Component({
      name,
      box,
      version: parseInt(version),
      scope,
      implFile,
      specsFile,
      miscFiles,
      compilerId: compilerId ? BitId.parse(compilerId) : null,
      testerId: testerId ? BitId.parse(testerId) : null,
      dependencies: BitIds.fromObject(dependencies),
      packageDependencies,
      impl: Impl.deserialize(impl),
      specs: specs ? Specs.deserialize(specs) : null,
      misc: misc ? Misc.deserialize(misc) : null,
      docs,
      dist: dist ? Dist.deserialize(dist) : null,
      specsResults: specsResults ? SpecsResults.deserialize(specsResults) : null,
      license: license ? License.deserialize(license) : null,
      deprecate,
    });
  }

  static fromString(str: string): Component {
    const object = JSON.parse(str);
    return this.fromObject(object);
  }

  static loadFromInline(bitDir, consumerBitJson): Promise<Component> {
    if (!fs.existsSync(bitDir)) return Promise.reject(new ComponentNotFoundInline(bitDir));
    return BitJson.load(bitDir, consumerBitJson)
    .then((bitJson) => {
      const miscFiles = bitJson.getMiscFiles();

      return new Component({
        name: path.basename(bitDir),
        box: path.basename(path.dirname(bitDir)),
        implFile: bitJson.getImplBasename(),
        specsFile: bitJson.getSpecBasename(),
        miscFiles,
        compilerId: BitId.parse(bitJson.compilerId),
        testerId: BitId.parse(bitJson.testerId),
        dependencies: BitIds.fromObject(bitJson.dependencies),
        packageDependencies: bitJson.packageDependencies,
        impl: path.join(bitDir, bitJson.getImplBasename()),
        specs: path.join(bitDir, bitJson.getSpecBasename()),
        misc: miscFiles ? miscFiles.map(misc => path.join(bitDir, misc)) : [],
      });
    });
  }

  static create({ scopeName, name, box, withSpecs, consumerBitJson }:{
    consumerBitJson: ConsumerBitJson,
    name: string,
    box: string,
    scopeName?: ?string,
    withSpecs?: ?boolean,
  }, scope: Scope) {
    const implFile = consumerBitJson.getImplBasename();
    const specsFile = consumerBitJson.getSpecBasename();
    const miscFiles = consumerBitJson.getMiscFiles();
    const compilerId = BitId.parse(consumerBitJson.compilerId);
    const testerId = BitId.parse(consumerBitJson.testerId);

    return new Component({
      name,
      box,
      version: DEFAULT_BIT_VERSION,
      scope: scopeName,
      implFile,
      specsFile,
      miscFiles,
      compilerId,
      testerId,
      impl: Impl.create(name, compilerId, scope),
      specs: withSpecs ? Specs.create(name, testerId, scope) : undefined,
    });
  }
}
