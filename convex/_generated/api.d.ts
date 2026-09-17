/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as checkSlop from "../checkSlop.js";
import type * as connections from "../connections.js";
import type * as generatePost from "../generatePost.js";
import type * as lib_analytics from "../lib/analytics.js";
import type * as lib_bluesky from "../lib/bluesky.js";
import type * as lib_composio from "../lib/composio.js";
import type * as lib_imageGen from "../lib/imageGen.js";
import type * as publishPost from "../publishPost.js";
import type * as queries from "../queries.js";
import type * as schedulePost from "../schedulePost.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  checkSlop: typeof checkSlop;
  connections: typeof connections;
  generatePost: typeof generatePost;
  "lib/analytics": typeof lib_analytics;
  "lib/bluesky": typeof lib_bluesky;
  "lib/composio": typeof lib_composio;
  "lib/imageGen": typeof lib_imageGen;
  publishPost: typeof publishPost;
  queries: typeof queries;
  schedulePost: typeof schedulePost;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
