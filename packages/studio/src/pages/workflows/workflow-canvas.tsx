import { findStep, type WorkflowStepInput } from '@devias/core';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  type IconName,
} from '@devias/ui';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { memo, useEffect, useMemo } from 'react';
import { type EdgeAdd, type InsertAt, layoutWorkflow } from './workflow-tree';

import '@xyflow/react/dist/style.css';
import type { StepPreset } from './workflow-list';

/**
 * The workflow as a diagram: the trigger on top, steps flowing down, an If / else fanning into a Yes lane and a No
 * lane. Lanes end on their own; they only meet again when steps follow the If / else. The canvas is a view over the
 * step tree: nothing is dragged or wired by hand. Clicking a node selects it for the editor beside the canvas, and
 * the "+" on an edge or at the end of a list adds a step there.
 */

export type CanvasSelection = { kind: 'trigger' } | { kind: 'step'; id: string };

/** Which presets "+" offers, and why one may be unavailable. */
export type StepKindOption = {
  value: StepPreset;
  label: string;
  icon: IconName;
  disabled?: boolean;
};

export type CanvasStepView = {
  step: WorkflowStepInput;
  title: string;
  summary: string;
  icon: IconName;
};

export interface WorkflowCanvasProps {
  steps: WorkflowStepInput[];
  triggerTitle: string;
  triggerSummary: string;
  triggerIcon: IconName;
  /** How each step reads on its node. */
  describe: (step: WorkflowStepInput) => CanvasStepView;
  kinds: StepKindOption[];
  selected: CanvasSelection | null;
  onSelect: (selection: CanvasSelection | null) => void;
  onAdd: (at: InsertAt, preset: StepPreset) => void;
}

type Callbacks = {
  kinds: StepKindOption[];
  onSelect: (selection: CanvasSelection) => void;
  onAdd: (at: InsertAt, preset: StepPreset) => void;
};

type TriggerNode = Node<{ title: string; summary: string; icon: IconName; selected: boolean } & Callbacks, 'trigger'>;
type StepNode = Node<CanvasStepView & { selected: boolean } & Callbacks, 'step'>;
type BranchNode = Node<CanvasStepView & { selected: boolean } & Callbacks, 'branch'>;
type AddNode = Node<{ insert: InsertAt; label: string } & Callbacks, 'add'>;
type CanvasNode = TriggerNode | StepNode | BranchNode | AddNode;
type FlowEdge = Edge<
  { lane?: 'yes' | 'no'; adds: (EdgeAdd & { label: string })[]; kinds: StepKindOption[]; onAdd: Callbacks['onAdd'] },
  'flow'
>;

const card =
  'flex h-full w-full items-center gap-3 rounded-lg border border-border bg-card px-3.5 text-left shadow-xs transition-[border-color,box-shadow] hover:border-foreground/25 hover:shadow-sm';
const selectedCard = 'border-foreground/60 ring-4 ring-foreground/10 hover:border-foreground/60';
const chip = 'flex size-10 shrink-0 items-center justify-center rounded-lg';
/** The icon chip colors of each kind of node; the panel beside the canvas wears the same ones. */
export const NODE_TONE = {
  trigger: 'bg-primary text-primary-foreground',
  action: 'bg-muted text-foreground',
  branch: 'bg-warning/15 text-warning',
} as const;
const eyebrow = 'block text-[10.5px] leading-none font-medium tracking-wider text-muted-foreground uppercase';
/** React Flow needs the handles to measure and draw edges; people never see or use them. */
const handle = '!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0';

function AddMenu({
  at,
  kinds,
  onAdd,
  children,
}: {
  at: InsertAt;
  kinds: StepKindOption[];
  onAdd: (at: InsertAt, preset: StepPreset) => void;
  children: React.ReactElement;
}) {
  // A workflow that cannot be changed offers nothing to add.
  if (kinds.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={children} />
      <DropdownMenuContent align="center" className="w-52">
        {kinds.map((kind) => (
          <DropdownMenuItem key={kind.value} disabled={kind.disabled} onClick={() => onAdd(at, kind.value)}>
            <Icon name={kind.icon} /> {kind.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TriggerNodeView = memo(({ data }: NodeProps<TriggerNode>) => (
  <div className="h-full w-full">
    <button
      type="button"
      data-canvas-node="trigger"
      className={cn(card, data.selected && selectedCard)}
      onClick={() => data.onSelect({ kind: 'trigger' })}
    >
      <span className={cn(chip, NODE_TONE.trigger)}>
        <Icon name={data.icon} className="size-[18px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={eyebrow}>Trigger</span>
        <span className="block truncate text-xs leading-tight font-medium">{data.title}</span>
        <span className="block truncate text-xs leading-tight text-muted-foreground">{data.summary}</span>
      </span>
    </button>
    <Handle type="source" position={Position.Bottom} className={handle} />
  </div>
));

const StepNodeView = memo(({ id, data }: NodeProps<StepNode>) => (
  <div className="h-full w-full">
    <Handle type="target" position={Position.Top} className={handle} />
    <button
      type="button"
      data-canvas-node="step"
      className={cn(card, data.selected && selectedCard)}
      onClick={() => data.onSelect({ kind: 'step', id })}
    >
      <span className={cn(chip, NODE_TONE.action)}>
        <Icon name={data.icon} className="size-[18px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={eyebrow}>Action</span>
        <span className="block truncate text-xs leading-tight font-medium">{data.title}</span>
        <span className="block truncate text-xs leading-tight text-muted-foreground">{data.summary}</span>
      </span>
    </button>
    <Handle type="source" position={Position.Bottom} className={handle} />
  </div>
));

const BranchNodeView = memo(({ id, data }: NodeProps<BranchNode>) => (
  <div className="h-full w-full">
    <Handle type="target" position={Position.Top} className={handle} />
    <button
      type="button"
      data-canvas-node="branch"
      className={cn(card, 'border-warning/30 bg-warning/[0.06] hover:border-warning/50', data.selected && selectedCard)}
      onClick={() => data.onSelect({ kind: 'step', id })}
    >
      <span className={cn(chip, NODE_TONE.branch)}>
        <Icon name={data.icon} className="size-[18px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn(eyebrow, 'text-warning/80')}>Condition</span>
        <span className="block truncate text-xs leading-tight font-medium">{data.title}</span>
        <span className="block truncate text-xs leading-tight text-muted-foreground">{data.summary}</span>
      </span>
    </button>
    <Handle type="source" position={Position.Bottom} className={handle} />
  </div>
));

/** The round "+" that ends a list, or stands in for an empty lane. */
const AddNodeView = memo(({ data }: NodeProps<AddNode>) => (
  <div className="h-full w-full">
    <Handle type="target" position={Position.Top} className={handle} />
    <AddMenu at={data.insert} kinds={data.kinds} onAdd={data.onAdd}>
      <button
        type="button"
        data-canvas-node="add"
        aria-label={data.label}
        className="nodrag nopan flex size-full items-center justify-center rounded-full border border-dashed border-muted-foreground/50 bg-card text-muted-foreground transition-colors hover:border-solid hover:border-foreground/50 hover:text-foreground"
      >
        <Icon name="plus" className="size-3.5" />
      </button>
    </AddMenu>
    {/* A lane's "+" stands in for an empty lane, so the edge to the step after the branch leaves from it. */}
    <Handle type="source" position={Position.Bottom} className={handle} />
  </div>
));

const place = (add: EdgeAdd, geometry: { sourceX: number; sourceY: number; targetX: number; targetY: number }) => {
  switch (add.anchor) {
    case 'source':
      return { x: geometry.sourceX, y: geometry.sourceY + 24 };
    case 'target':
      return { x: geometry.targetX, y: geometry.targetY - 24 };
    default:
      return null;
  }
};

/** A step edge with a smooth elbow, "+" buttons to insert along it, and a Yes or No pill where a lane forks. */
function FlowEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<FlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
  });
  const lane = data?.lane;
  const at = (x: number, y: number) => ({ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.5, strokeWidth: 1.5 }}
      />
      <EdgeLabelRenderer>
        {lane ? (
          <div
            className={cn(
              'nodrag nopan absolute rounded-full border bg-card px-2 py-0.5 text-[11px] leading-none font-medium shadow-xs',
              lane === 'yes' ? 'border-success/40 text-success' : 'border-border text-muted-foreground',
            )}
            style={at(targetX, labelY)}
          >
            {lane === 'yes' ? 'Yes' : 'No'}
          </div>
        ) : null}
        {data?.adds.map((add) => {
          const spot = place(add, { sourceX, sourceY, targetX, targetY }) ?? { x: labelX, y: labelY };

          return (
            <div
              key={`${add.anchor}:${add.at.kind}`}
              className="nodrag nopan pointer-events-auto absolute"
              style={at(spot.x, spot.y)}
            >
              <AddMenu at={add.at} kinds={data.kinds} onAdd={data.onAdd}>
                <button
                  type="button"
                  aria-label={add.label}
                  className="flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:border-foreground/40 hover:bg-muted hover:text-foreground"
                >
                  <Icon name="plus" className="size-3" />
                </button>
              </AddMenu>
            </div>
          );
        })}
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { trigger: TriggerNodeView, step: StepNodeView, branch: BranchNodeView, add: AddNodeView };
const edgeTypes = { flow: FlowEdgeView };

/** Keep the whole diagram in view as it grows. */
function FitOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    // The signature changes whenever the layout grows or shrinks; refit each time it does.
    if (!signature) {
      return;
    }

    void fitView({ padding: 0.15, maxZoom: 1, duration: 150 });
  }, [fitView, signature]);

  return null;
}

function Canvas(props: WorkflowCanvasProps) {
  const { steps, describe, kinds, selected, onSelect, onAdd } = props;
  const layout = useMemo(() => layoutWorkflow(steps), [steps]);
  const callbacks: Callbacks = useMemo(() => ({ kinds, onSelect, onAdd }), [kinds, onSelect, onAdd]);
  const titleOf = useMemo(
    () => (id: string) => describe(findStep(steps, id) ?? { kind: 'action', actionId: '', input: {} }).title,
    [describe, steps],
  );
  const labelOf = useMemo(
    () =>
      (at: InsertAt): string => {
        switch (at.kind) {
          case 'after':
            return `Add a step after ${titleOf(at.id)}`;
          case 'lane':
            return `Add a step to the ${at.lane === 'yes' ? 'Yes' : 'No'} lane`;
          case 'start':
            return 'Add a step at the start';
          default:
            return 'Add a step';
        }
      },
    [titleOf],
  );
  const nodes = useMemo<CanvasNode[]>(
    () =>
      layout.nodes.map((node) => {
        const position = { x: node.x, y: node.y };
        const size = { width: node.width, height: node.height };

        switch (node.kind) {
          case 'trigger':
            return {
              id: node.id,
              type: 'trigger',
              position,
              ...size,
              data: {
                title: props.triggerTitle,
                summary: props.triggerSummary,
                icon: props.triggerIcon,
                selected: selected?.kind === 'trigger',
                ...callbacks,
              },
            };
          case 'add':
            return {
              id: node.id,
              type: 'add',
              position,
              ...size,
              data: { insert: node.insert, label: labelOf(node.insert), ...callbacks },
            };
          default:
            return {
              id: node.id,
              type: node.kind,
              position,
              ...size,
              data: {
                ...describe(node.step),
                selected: selected?.kind === 'step' && selected.id === node.id,
                ...callbacks,
              },
            };
        }
      }),
    [layout, describe, selected, callbacks, labelOf, props.triggerTitle, props.triggerSummary, props.triggerIcon],
  );
  const edges = useMemo<FlowEdge[]>(
    () =>
      layout.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'flow',
        data: {
          ...(edge.lane ? { lane: edge.lane } : {}),
          adds: edge.adds.map((add) => ({ ...add, label: labelOf(add.at) })),
          kinds,
          onAdd,
        },
      })),
    [layout, labelOf, kinds, onAdd],
  );
  const signature = `${layout.width}x${layout.height}:${layout.nodes.length}`;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.25}
      maxZoom={1.5}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnScroll
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      onPaneClick={() => onSelect(null)}
      // Without a click handler React Flow gives static nodes `pointer-events: none`, which would swallow the buttons.
      onNodeClick={(_, node) => {
        if (node.type === 'trigger') {
          onSelect({ kind: 'trigger' });
        } else if (node.type === 'step' || node.type === 'branch') {
          onSelect({ kind: 'step', id: node.id });
        }
      }}
      proOptions={{ hideAttribution: false }}
      style={
        {
          '--xy-background-color': 'transparent',
          '--xy-controls-button-background-color-default': 'var(--card)',
          '--xy-controls-button-background-color-hover-default': 'var(--muted)',
          '--xy-controls-button-color-default': 'var(--muted-foreground)',
          '--xy-controls-button-border-color-default': 'var(--border)',
          '--xy-controls-box-shadow-default': 'none',
        } as React.CSSProperties
      }
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1.25}
        color="color-mix(in oklab, var(--muted-foreground) 28%, transparent)"
      />
      <Controls showInteractive={false} position="top-right" />
      <FitOnChange signature={signature} />
    </ReactFlow>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <div className="h-full w-full bg-background-secondary" data-slot="workflow-canvas">
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
