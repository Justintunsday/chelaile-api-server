import type { IncomingMessage, ServerResponse } from "node:http";

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  pathname: string;
  params: Record<string, string>;
  ip: string;
}

export type RouteHandler = (ctx: RequestContext) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export type MatchResult =
  | { type: "matched"; handler: RouteHandler; params: Record<string, string> }
  | { type: "method_not_allowed" }
  | { type: "not_found" };

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment.length > 0);
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler): void {
    this.routes.push({
      method: method.toUpperCase(),
      segments: splitPath(path),
      handler,
    });
  }

  get(path: string, handler: RouteHandler): void {
    this.add("GET", path, handler);
  }

  match(method: string, pathname: string): MatchResult {
    const target = splitPath(pathname);
    let pathMatched = false;

    for (const route of this.routes) {
      if (route.segments.length !== target.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const routeSegment = route.segments[i];
        if (routeSegment.startsWith(":")) {
          params[routeSegment.slice(1)] = decodeURIComponent(target[i]);
        } else if (routeSegment !== target[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (route.method === method.toUpperCase()) {
        return { type: "matched", handler: route.handler, params };
      }
    }

    return pathMatched ? { type: "method_not_allowed" } : { type: "not_found" };
  }
}
