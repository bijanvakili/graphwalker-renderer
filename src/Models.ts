// Models for renderer

// Allows for a reference to be any of the following:
//
// 1. reference actual object
// 2. string id (to use a LookupObjectFunction in RenderSettings)
// 3. function returning the object (for deferred evaluation)
export type DeferredCallbable<T> = () => T;
export type FlexibleReference<T> = T | string | DeferredCallbable<T>;

export type LookupObjectFunction<T> = (id: string) => T;

export type LookupLabelFunction = (id: string) => string;

export type ItemSelectedCallback = (id: string) => void;

interface WithId {
  id: string;
}

interface WithIdAndLabel extends WithId {
  label: FlexibleReference<string>;
}

export interface VertexImage extends WithId {
  filename: string;
  height: number;
  width: number;
}

export type Vertex = WithIdAndLabel;

export interface Edge extends WithIdAndLabel {
  label: string;
  source: FlexibleReference<Vertex>;
  dest: FlexibleReference<Vertex>;
}

export interface Subgraph {
  edges: FlexibleReference<Edge>[];
}
