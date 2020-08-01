import * as d3 from "d3-selection";
import classnames from "classnames";

import {
  IncidentEdgeDirection,
  ImageIdentifier,
  Justification,
} from "./Constants";
import {
  Edge,
  ItemSelectedCallback,
  DeferredCallbable,
  VertexImage,
  Vertex,
  Subgraph,
  FlexibleReference,
  LookupObjectFunction,
} from "./Models";
import { Point } from "./types/ObjectTypes";

const svgTemplatePrefix = "svgTemplate_";
const viewMarginX = 10;
const viewMarginY = 15;
const vertexIconMargin: Point = { x: 2, y: 2 };
const vertexTextMarginY = 5;
const neighborMarginY = 18;
const vertexTextHeight = 14;
const edgeTextHeight = 12;

// TODO change this once SVG2 is supported
const attrHref = "xlink:xlink:href";

type NeighborOffsets = { [key in IncidentEdgeDirection]: number };

export interface RenderSettings {
  targetVertex: FlexibleReference<Vertex>;
  vertexColumnPageSize: number;

  getVertexImageById: LookupObjectFunction<VertexImage>;
  getVertexById?: LookupObjectFunction<Vertex>;
  getEdgeById?: LookupObjectFunction<Edge>;
  onVertexSelected?: ItemSelectedCallback;
}

export interface SubgraphProps {
  svg: SVGSVGElement;
  graph: Subgraph;
  settings: RenderSettings;
}

class VertexLayout {
  readonly vertex: Vertex;
  readonly position: Point;
  readonly justification: Justification;

  constructor(vertex: Vertex, position: Point, justification: Justification) {
    this.vertex = vertex;
    this.position = position;
    this.justification = justification;
  }

  get id(): string {
    return `${this.justification}/${this.vertex.id}`;
  }
}

type JustificationNoCenter = Justification.Left | Justification.Right;

class EdgeLayout {
  readonly edge: Edge;
  readonly segments: Point[]; // segments are drawn left to right
  readonly justification: JustificationNoCenter;
  readonly labelPosition: Point;

  constructor(
    edge: Edge,
    segments: Point[],
    justification: JustificationNoCenter,
    labelPosition: Point
  ) {
    this.edge = edge;
    this.segments = segments;
    this.justification = justification;
    this.labelPosition = labelPosition;
  }

  get id(): string {
    return `${this.justification}/${this.edge.id}`;
  }
}

interface AdjacentVertex {
  edge: Edge;
  other: Vertex;
}

interface GraphLayout {
  // NOTE: first entry in the array is always the target vertex
  vertices: VertexLayout[];
  edges: EdgeLayout[];
}

// TODO export this
interface ImageMetadataMap {
  [key: string]: VertexImage;
}

export interface Renderer {
  render(pageOffsets: NeighborOffsets): void;
  remove(): void;
}

function getPointsPath(segments: Point[]): string {
  return segments.map((p: Point) => `${p.x},${p.y}`).join(" ");
}

// factory for evaluating FlexibleReferences
function makeObjectSelector<T>(findById?: LookupObjectFunction<T>) {
  return (obj: FlexibleReference<T>): T => {
    if (typeof obj === "function") {
      return (obj as DeferredCallbable<T>)();
    }

    if (findById && typeof obj === "string") {
      return findById(obj);
    }

    if (obj as T) {
      return obj as T;
    }

    throw Error("Unable to find edge reference");
  };
}

// renders a subgraph: the neighorhood of the current vertices
class SubgraphRenderer implements Renderer {
  private svg: SVGSVGElement;
  private graph: Subgraph;
  private settings: RenderSettings;
  private vertexGroupHeight: number;
  private images: ImageMetadataMap;
  private vertexColumnPageSize: number;
  private onClickVertex: ItemSelectedCallback;

  constructor(props: SubgraphProps) {
    this.svg = props.svg;
    this.graph = props.graph;
    this.settings = props.settings;

    this.images = Object.keys(ImageIdentifier).reduce((accum, k) => {
      // TODO fix this cast to any (TypeScript enums suck at iterating)
      const v: string = (ImageIdentifier as any)[k];
      return {
        ...accum,
        [v]: this.settings.getVertexImageById(v),
      };
      // tslint:disable-next-line:align
    }, {});

    this.vertexGroupHeight =
      this.images.vertexIcon.height +
      vertexTextHeight +
      2 * vertexIconMargin.y +
      neighborMarginY;
    this.vertexColumnPageSize = props.settings.vertexColumnPageSize;
    if (props.settings.onVertexSelected) {
      this.onClickVertex = props.settings.onVertexSelected;
    } else {
      // tslint:disable-next-line:no-empty
      this.onClickVertex = (id: string) => {};
    }
  }

  // entry point to graph the localized subgraph
  render(pageOffsets: NeighborOffsets) {
    // remove pre-existing objects to force a redraw
    this.remove();

    const images = this.images;
    const svgSelection = this.selectSvg();

    // add image templates
    svgSelection
      .selectAll("symbol")
      .data(Object.keys(images).map((k) => images[k]))
      .enter()
      .append("symbol")
      .attr("id", (img) => `${svgTemplatePrefix}${img.id}`)
      .append("image")
      .attr(attrHref, (img) => `images/${img.filename}`)
      .attr("width", (img) => img.width)
      .attr("height", (img) => img.height);

    const selectEdge = makeObjectSelector<Edge>(this.settings.getEdgeById);
    const selectVertex = makeObjectSelector<Vertex>(
      this.settings.getVertexById
    );
    const selectLabel = makeObjectSelector<string>();

    const targetVertex: Vertex = selectVertex(this.settings.targetVertex);

    // filter incoming and outgoing vertices with pagination (offset and max size)
    const incomingAdjacencies: AdjacentVertex[] = this.graph.edges
      .map((ref) => selectEdge(ref))
      .filter((e) => selectVertex(e.dest) === targetVertex)
      .map((edge) => ({ edge, other: selectVertex(edge.source) }))
      .slice(
        pageOffsets.incoming,
        pageOffsets.incoming + this.vertexColumnPageSize
      );

    const outgoingAdjacencies: AdjacentVertex[] = this.graph.edges
      .map((ref) => selectEdge(ref))
      .filter((e) => selectVertex(e.source) === targetVertex)
      .map((edge) => ({ edge, other: selectVertex(edge.dest) }))
      .slice(
        pageOffsets.outgoing,
        pageOffsets.outgoing + this.vertexColumnPageSize
      );

    const currentVertexId = targetVertex.id;
    const layout = this.getGraphLayout(
      targetVertex,
      incomingAdjacencies,
      outgoingAdjacencies
    );
    // tslint:disable-next-line:no-empty
    let onClickVertexElement = (vl: VertexLayout): void => {};
    if (this.onClickVertex) {
      onClickVertexElement = (vl: VertexLayout) => {
        const e = d3.event;
        e.stopPropagation();
        e.preventDefault();
        this.onClickVertex(vl.vertex.id);
      };
    }

    const drawRootSelection: d3.Selection<
      d3.BaseType,
      Vertex,
      SVGGElement,
      any
    > = svgSelection.append("g").selectAll("g");

    // add placholder groups (<g>) for each vertex
    const vertexPlaceholders = drawRootSelection
      .data(layout.vertices, (vl) => vl.id)
      .enter()
      .append("g")
      .attr("transform", (vl) => {
        return `translate(${vl.position.x} ${vl.position.y})`;
      });

    // draw the vertex icons
    vertexPlaceholders
      .append("use")
      .attr(attrHref, `#${svgTemplatePrefix}${ImageIdentifier.VertexIcon}`)
      .attr("x", vertexIconMargin.x)
      .attr("y", vertexIconMargin.y)
      .on("click", onClickVertexElement);

    // draw the vertex labels
    const vertexTextXOffsets = {
      [Justification.Left]: vertexIconMargin.x,
      [Justification.Center]:
        vertexIconMargin.x + this.images.vertexIcon.width / 2,
      [Justification.Right]: vertexIconMargin.x + this.images.vertexIcon.width,
    };
    vertexPlaceholders
      .append("text")
      .attr("class", (vl) => classnames("graph-vertex-label", vl.justification))
      .text((vl) => selectLabel(vl.vertex.label))
      .attr("x", (vl) => vertexTextXOffsets[vl.justification])
      .attr("y", this.vertexGroupHeight - neighborMarginY + vertexTextMarginY)
      .on("click", onClickVertexElement);

    // disable click handler for target vertex
    vertexPlaceholders
      .data([currentVertexId])
      .enter()
      .selectAll("use, text")
      .on("click", null);

    // add placeholder groups (<g>) for each edge
    const edgePlaceholders = drawRootSelection
      .data(layout.edges, (el) => el.id)
      .enter()
      .append("g");

    // draw the segmented path for each edge
    const edgeXOffsets = {
      [Justification.Left]:
        vertexIconMargin.x + this.images.vertexIcon.width - 1,
      [Justification.Right]: vertexIconMargin.x + 1,
    };
    edgePlaceholders
      .append("polyline")
      .attr("class", "graph-edge-line")
      .attr("points", (el) => {
        const justification = el.justification;
        const adjustedSegments = el.segments.map((segment: Point) => ({
          x: segment.x + edgeXOffsets[justification],
          y: segment.y + vertexIconMargin.y + this.images.vertexIcon.height / 2,
        }));
        if (justification === Justification.Left) {
          adjustedSegments[3].x -=
            this.images.vertexIcon.width - vertexIconMargin.x;
        } else {
          adjustedSegments[0].x +=
            this.images.vertexIcon.width - vertexIconMargin.x;
        }
        return getPointsPath(adjustedSegments);
      });

    // draw the edge labels
    edgePlaceholders
      .append("text")
      .attr("class", (el) => classnames("graph-edge-label", el.justification))
      .attr("x", (el) => {
        return el.labelPosition.x + edgeXOffsets[el.justification];
      })
      .attr("y", (el) => {
        return (
          el.labelPosition.y +
          vertexIconMargin.y +
          this.images.vertexIcon.height / 2 +
          edgeTextHeight
        );
      })
      .text((el) => selectLabel(el.edge.label));

    const currentTargetPosition = layout.vertices[0].position;
    const arrowPositionX = {
      [Justification.Left]: (5 / 6) * (currentTargetPosition.x - viewMarginX),
      [Justification.Right]: (7 / 6) * (currentTargetPosition.x - viewMarginX),
    };
    const enabledArrows: JustificationNoCenter[] = [];
    if (incomingAdjacencies.length > 0) {
      enabledArrows.push(Justification.Left);
    }
    if (outgoingAdjacencies.length > 0) {
      enabledArrows.push(Justification.Right);
    }

    drawRootSelection
      .data(enabledArrows)
      .enter()
      .append("use")
      .attr(attrHref, `#${svgTemplatePrefix}${ImageIdentifier.Arrow}`)
      .attr(
        "x",
        (justification: JustificationNoCenter) => arrowPositionX[justification]
      )
      .attr(
        "y",
        currentTargetPosition.y +
          vertexIconMargin.y +
          this.images.vertexIcon.height / 2 -
          this.images.arrow.height / 2
      );
  }

  // removes all d3 content (during unmount)
  remove() {
    this.selectSvg().selectAll("*").remove();
  }

  private selectSvg(): d3.Selection<SVGSVGElement, any, d3.BaseType, any> {
    return d3.select(this.svg);
  }

  /*
   * Hierarchical Layout algorithm for subgraph
   *
   * 3 static hierarchies directed horizontall from left to right
   *  1) incoming
   *  2) target vertex (center)
   *  3) outgoing
   */
  private getGraphLayout(
    targetVertex: Vertex,
    incoming: AdjacentVertex[],
    outgoing: AdjacentVertex[]
  ): GraphLayout {
    const layout: GraphLayout = {
      vertices: [],
      edges: [],
    };
    const svgWidth = this.svg.getBoundingClientRect().width;

    // place the target vertex in the center
    const targetVertexPosition = { x: svgWidth / 2, y: viewMarginY };
    layout.vertices.push(
      new VertexLayout(targetVertex, targetVertexPosition, Justification.Center)
    );

    // place the incoming vertices and edges on the left
    if (incoming.length > 0) {
      const segmentDiffX = (targetVertexPosition.x - viewMarginX) / 3;
      incoming.forEach((adj, idx: number) => {
        const vertexPosition = {
          x: viewMarginX,
          y: viewMarginY + idx * this.vertexGroupHeight,
        };

        layout.vertices.push(
          new VertexLayout(adj.other, vertexPosition, Justification.Left)
        );
        layout.edges.push(
          new EdgeLayout(
            adj.edge,
            [
              vertexPosition,
              { x: vertexPosition.x + segmentDiffX, y: vertexPosition.y },
              {
                x: vertexPosition.x + 2 * segmentDiffX,
                y: targetVertexPosition.y,
              },
              targetVertexPosition,
            ],
            Justification.Left,
            vertexPosition
          )
        );
      });
    }

    // place the outgoing vertices on the right
    if (outgoing.length > 0) {
      const outgoingPositionX =
        svgWidth - viewMarginX - this.images.vertexIcon.width;
      const segmentDiffX = (outgoingPositionX - targetVertexPosition.x) / 3;

      outgoing.forEach((adj, idx: number) => {
        const vertexPosition = {
          x: outgoingPositionX,
          y: viewMarginY + idx * this.vertexGroupHeight,
        };

        layout.vertices.push(
          new VertexLayout(adj.other, vertexPosition, Justification.Right)
        );
        layout.edges.push(
          new EdgeLayout(
            adj.edge,
            [
              targetVertexPosition,
              {
                x: targetVertexPosition.x + segmentDiffX,
                y: targetVertexPosition.y,
              },
              {
                x: targetVertexPosition.x + 2 * segmentDiffX,
                y: vertexPosition.y,
              },
              vertexPosition,
            ],
            Justification.Right,
            vertexPosition
          )
        );
      });
    }

    return layout;
  }
}

export function makeRenderer(props: SubgraphProps): Renderer {
  return new SubgraphRenderer(props);
}
