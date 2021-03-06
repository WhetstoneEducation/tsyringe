"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.instance = exports.typeInfo = void 0;
const providers_1 = require("./providers");
const provider_1 = require("./providers/provider");
const injection_token_1 = require("./providers/injection-token");
const registry_1 = require("./registry");
const lifecycle_1 = require("./types/lifecycle");
const resolution_context_1 = require("./resolution-context");
const error_helpers_1 = require("./error-helpers");
const lazy_helpers_1 = require("./lazy-helpers");
exports.typeInfo = new Map();
class InternalDependencyContainer {
    constructor(parent) {
        this.parent = parent;
        this._registry = new registry_1.default();
    }
    register(token, providerOrConstructor, options = { lifecycle: lifecycle_1.default.Transient }) {
        let provider;
        if (!provider_1.isProvider(providerOrConstructor)) {
            provider = { useClass: providerOrConstructor };
        }
        else {
            provider = providerOrConstructor;
        }
        if (options.lifecycle === lifecycle_1.default.Singleton ||
            options.lifecycle == lifecycle_1.default.ContainerScoped ||
            options.lifecycle == lifecycle_1.default.ResolutionScoped) {
            if (providers_1.isValueProvider(provider) || providers_1.isFactoryProvider(provider)) {
                throw new Error(`Cannot use lifecycle "${lifecycle_1.default[options.lifecycle]}" with ValueProviders or FactoryProviders`);
            }
        }
        this._registry.set(token, { provider, options });
        return this;
    }
    registerType(from, to) {
        if (providers_1.isNormalToken(to)) {
            return this.register(from, {
                useToken: to
            });
        }
        return this.register(from, {
            useClass: to
        });
    }
    registerInstance(token, instance) {
        return this.register(token, {
            useValue: instance
        });
    }
    registerSingleton(from, to) {
        if (providers_1.isNormalToken(from)) {
            if (providers_1.isNormalToken(to)) {
                return this.register(from, {
                    useToken: to
                }, { lifecycle: lifecycle_1.default.Singleton });
            }
            else if (to) {
                return this.register(from, {
                    useClass: to
                }, { lifecycle: lifecycle_1.default.Singleton });
            }
            throw new Error('Cannot register a type name as a singleton without a "to" token');
        }
        let useClass = from;
        if (to && !providers_1.isNormalToken(to)) {
            useClass = to;
        }
        return this.register(from, {
            useClass
        }, { lifecycle: lifecycle_1.default.Singleton });
    }
    resolve(token, context = new resolution_context_1.default()) {
        const registration = this.getRegistration(token);
        if (!registration && providers_1.isNormalToken(token)) {
            throw new Error(`Attempted to resolve unregistered dependency token: "${token.toString()}"`);
        }
        if (registration) {
            return this.resolveRegistration(registration, context);
        }
        if (injection_token_1.isConstructorToken(token)) {
            return this.construct(token, context);
        }
        throw new Error("Attempted to construct an undefined constructor. Could mean a circular dependency problem. Try using `delay` function.");
    }
    resolveRegistration(registration, context) {
        if (registration.options.lifecycle === lifecycle_1.default.ResolutionScoped &&
            context.scopedResolutions.has(registration)) {
            return context.scopedResolutions.get(registration);
        }
        const isSingleton = registration.options.lifecycle === lifecycle_1.default.Singleton;
        const isContainerScoped = registration.options.lifecycle === lifecycle_1.default.ContainerScoped;
        const returnInstance = isSingleton || isContainerScoped;
        let resolved;
        if (providers_1.isValueProvider(registration.provider)) {
            resolved = registration.provider.useValue;
        }
        else if (providers_1.isTokenProvider(registration.provider)) {
            resolved = returnInstance
                ? registration.instance ||
                    (registration.instance = this.resolve(registration.provider.useToken, context))
                : this.resolve(registration.provider.useToken, context);
        }
        else if (providers_1.isClassProvider(registration.provider)) {
            resolved = returnInstance
                ? registration.instance ||
                    (registration.instance = this.construct(registration.provider.useClass, context))
                : this.construct(registration.provider.useClass, context);
        }
        else if (providers_1.isFactoryProvider(registration.provider)) {
            resolved = registration.provider.useFactory(this);
        }
        else {
            resolved = this.construct(registration.provider, context);
        }
        if (registration.options.lifecycle === lifecycle_1.default.ResolutionScoped) {
            context.scopedResolutions.set(registration, resolved);
        }
        return resolved;
    }
    resolveAll(token, context = new resolution_context_1.default()) {
        const registrations = this.getAllRegistrations(token);
        if (!registrations && providers_1.isNormalToken(token)) {
            throw new Error(`Attempted to resolve unregistered dependency token: "${token.toString()}"`);
        }
        if (registrations) {
            return registrations.map(item => this.resolveRegistration(item, context));
        }
        return [this.construct(token, context)];
    }
    isRegistered(token, recursive = false) {
        return (this._registry.has(token) ||
            (recursive &&
                (this.parent || false) &&
                this.parent.isRegistered(token, true)));
    }
    reset() {
        this._registry.clear();
    }
    clearInstances() {
        for (const [token, registrations] of this._registry.entries()) {
            this._registry.setAll(token, registrations
                .filter(registration => !providers_1.isValueProvider(registration.provider))
                .map(registration => {
                registration.instance = undefined;
                return registration;
            }));
        }
    }
    createChildContainer() {
        const childContainer = new InternalDependencyContainer(this);
        for (const [token, registrations] of this._registry.entries()) {
            if (registrations.some(({ options }) => options.lifecycle === lifecycle_1.default.ContainerScoped)) {
                childContainer._registry.setAll(token, registrations.map(registration => {
                    if (registration.options.lifecycle === lifecycle_1.default.ContainerScoped) {
                        return {
                            provider: registration.provider,
                            options: registration.options
                        };
                    }
                    return registration;
                }));
            }
        }
        return childContainer;
    }
    getRegistration(token) {
        if (this.isRegistered(token)) {
            return this._registry.get(token);
        }
        if (this.parent) {
            return this.parent.getRegistration(token);
        }
        return null;
    }
    getAllRegistrations(token) {
        if (this.isRegistered(token)) {
            return this._registry.getAll(token);
        }
        if (this.parent) {
            return this.parent.getAllRegistrations(token);
        }
        return null;
    }
    construct(ctor, context) {
        if (ctor instanceof lazy_helpers_1.DelayedConstructor) {
            return ctor.createProxy((target) => this.resolve(target, context));
        }
        if (ctor.length === 0) {
            return new ctor();
        }
        const paramInfo = exports.typeInfo.get(ctor);
        if (!paramInfo || paramInfo.length === 0) {
            throw new Error(`TypeInfo not known for "${ctor.name}"`);
        }
        const params = paramInfo.map(this.resolveParams(context, ctor));
        return new ctor(...params);
    }
    resolveParams(context, ctor) {
        return (param, idx) => {
            try {
                if (injection_token_1.isTokenDescriptor(param)) {
                    return param.multiple
                        ? this.resolveAll(param.token)
                        : this.resolve(param.token, context);
                }
                return this.resolve(param, context);
            }
            catch (e) {
                throw new Error(error_helpers_1.formatErrorCtor(ctor, idx, e));
            }
        };
    }
}
exports.instance = new InternalDependencyContainer();
exports.default = exports.instance;
