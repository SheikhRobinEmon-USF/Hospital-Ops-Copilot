/**
 * Early data fetch. A tiny inline script in <head> starts the first view's API requests while the
 * JavaScript bundle is still downloading, so the hospital name and KPIs paint as soon as React
 * hydrates instead of one network round trip later. `api.get` consumes these promises once.
 *
 * The URLs built here must match `api.ts` exactly (same parameter order).
 */
import { API_URL } from "./api";

export const HEADLINE_KPIS = [
  "operating_margin",
  "total_margin",
  "opex_per_adj_discharge",
  "npr_per_adj_discharge",
  "fte_per_adj_occupied_bed",
  "occupancy_rate",
  "alos",
  "days_in_ar",
];

export function prefetchScript(): string {
  const body = `(function(){try{
var A=${JSON.stringify(API_URL)},K=${JSON.stringify(HEADLINE_KPIS)};
var p=new URLSearchParams(location.search),c=p.get("ccn");if(!/^\\d{6}$/.test(c||""))c="100128";
var y=p.get("year"),v=p.get("view")||"overview",d=(p.get("peers")||"facility_type,bed_band").split(",").filter(Boolean);
if(v!=="overview")return;
function q(o){var s=new URLSearchParams();o.forEach(function(kv){if(kv[1]!==null&&kv[1]!==undefined&&kv[1]!=="")s.append(kv[0],kv[1])});var t=s.toString();return t?"?"+t:""}
var Y=y?[["year",y]]:[],D=d.map(function(x){return["peer_dims",x]});
var urls=["/health","/kpis","/hospitals/"+c+q(Y),"/hospitals/"+c+"/benchmark"+q(Y.concat(D)),"/hospitals/"+c+"/insights"+q(Y.concat(D)),"/hospitals/"+c+"/trend"+q(K.map(function(k){return["kpis",k]}).concat(D))];
var w=window.__hocPrefetch={};urls.forEach(function(u){var f=fetch(A+u).then(function(r){if(!r.ok)throw r;return r.json()});f.catch(function(){});w[A+u]=f});
}catch(e){}})();`;
  return body.replace(/\n/g, "");
}

export function takePrefetched<T>(url: string): Promise<T> | undefined {
  if (typeof window === "undefined") return undefined;
  const store = (window as unknown as { __hocPrefetch?: Record<string, Promise<T>> }).__hocPrefetch;
  const hit = store?.[url];
  if (hit && store) delete store[url];
  return hit;
}
