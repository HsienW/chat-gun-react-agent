import type { AuthorizationRequest } from "../authorization/authorization.js";
import type { PrincipalContext } from "../authorization/principal.js";
import type { ResourceRef } from "../authorization/resource-ref.js";
import type { RuntimeScope } from "../authorization/scope.js";
import type {
  Authorizer,
  ContextRefStore,
  FindRelatedOneHopOptions,
} from "./context-ref-store.js";
import type { ContextRef } from "./context-ref.js";

export interface ContextReferenceResolverOptions {
  relationType?: string;
  limit?: number;
}

export interface ContextReferenceResolver {
  findRelated(
    resource: ResourceRef,
    principal: PrincipalContext,
    scope: RuntimeScope,
    options?: ContextReferenceResolverOptions
  ): Promise<ResourceRef[]>;
}

function isSameResource(left: ResourceRef, right: ResourceRef): boolean {
  return (
    left.resourceType === right.resourceType &&
    left.resourceId === right.resourceId &&
    left.tenantId === right.tenantId &&
    left.ownerScopeId === right.ownerScopeId
  );
}

function relatedResource(resource: ResourceRef, contextRef: ContextRef): ResourceRef {
  return isSameResource(resource, contextRef.source)
    ? contextRef.target
    : contextRef.source;
}

function toFindOptions(
  options: ContextReferenceResolverOptions | undefined
): FindRelatedOneHopOptions {
  return {
    ...(options?.relationType === undefined
      ? {}
      : { relationType: options.relationType }),
    ...(options?.limit === undefined ? {} : { limit: options.limit }),
  };
}

function readRequest(
  principal: PrincipalContext,
  scope: RuntimeScope,
  resource: ResourceRef
): AuthorizationRequest {
  return {
    principal,
    scope,
    action: "read",
    resource,
  };
}

export class AuthorizedContextReferenceResolver
  implements ContextReferenceResolver
{
  constructor(
    private readonly store: ContextRefStore,
    private readonly authorizer: Authorizer
  ) {}

  async findRelated(
    resource: ResourceRef,
    principal: PrincipalContext,
    scope: RuntimeScope,
    options: ContextReferenceResolverOptions = {}
  ): Promise<ResourceRef[]> {
    try {
      const sourceDecision = await this.authorizer.authorize(
        readRequest(principal, scope, resource)
      );
      if (sourceDecision.effect !== "allow") return [];

      const contextRefs = await this.store.findRelatedOneHop(
        resource,
        toFindOptions(options)
      );
      const relatedResources: ResourceRef[] = [];
      const limit = options.limit ?? contextRefs.length;

      for (const contextRef of contextRefs) {
        const candidate = relatedResource(resource, contextRef);
        const targetDecision = await this.authorizer.authorize(
          readRequest(principal, scope, candidate)
        );
        if (targetDecision.effect === "allow") {
          relatedResources.push(candidate);
        }
        if (relatedResources.length >= limit) break;
      }

      return relatedResources;
    } catch {
      return [];
    }
  }
}
