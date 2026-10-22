import type { WorkflowStepInput } from '@devias/core';

/**
 * The step tree behind the workflow canvas: pure edits that return new arrays, and an auto-layout that turns the
 * tree into positioned nodes and edges. Steps run top to bottom; a branch fans out into a Yes lane and a No lane.
 * The lanes only meet again when steps follow the branch in its list; otherwise each lane simply ends.
 */

/** Where a new step goes. */
export type InsertAt =
  | { kind: 'start' }
  | { kind: 'after'; id: string }
  | { kind: 'lane'; branch: string; lane: 'yes' | 'no' }
  | { kind: 'end' };

const mapLanes = (
  step: WorkflowStepInput,
  fn: (list: WorkflowStepInput[]) => WorkflowStepInput[],
): WorkflowStepInput => (step.kind === 'branch' ? { ...step, yes: fn(step.yes), no: fn(step.no) } : step);

export const insertStep = (steps: WorkflowStepInput[], at: InsertAt, step: WorkflowStepInput): WorkflowStepInput[] => {
  if (at.kind === 'end') {
    return [...steps, step];
  }

  if (at.kind === 'start') {
    return [step, ...steps];
  }

  const out: WorkflowStepInput[] = [];

  for (const current of steps) {
    if (at.kind === 'lane' && current.kind === 'branch' && current.id === at.branch) {
      out.push({ ...current, [at.lane]: [step, ...current[at.lane]] });
      continue;
    }

    out.push(mapLanes(current, (list) => insertStep(list, at, step)));

    if (at.kind === 'after' && current.id === at.id) {
      out.push(step);
    }
  }

  return out;
};

export const replaceStep = (steps: WorkflowStepInput[], id: string, next: WorkflowStepInput): WorkflowStepInput[] =>
  steps.map((current) => (current.id === id ? next : mapLanes(current, (list) => replaceStep(list, id, next))));

/** Remove a step; removing a branch removes both lanes with it. */
export const removeStep = (steps: WorkflowStepInput[], id: string): WorkflowStepInput[] =>
  steps.filter((current) => current.id !== id).map((current) => mapLanes(current, (list) => removeStep(list, id)));

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

export const NODE_WIDTH = 248;
export const NODE_HEIGHT = 68;
/** The round "+" that ends a list. */
export const ADD_SIZE = 28;
/** Between a node and the next one. */
export const GAP_Y = 56;
/** Between the last step of a list and its closing "+". */
export const GAP_ADD = 36;
/** Between a branch and the first node of its lanes; room for the Yes/No pill and a "+". */
export const LANE_GAP = 96;
/** Between the ends of two lanes and the step that follows the branch. */
export const MERGE_GAP = 96;
export const GAP_X = 56;

export type LayoutNode =
  | { id: 'trigger'; kind: 'trigger'; x: number; y: number; width: number; height: number }
  | { id: string; kind: 'step'; x: number; y: number; width: number; height: number; step: WorkflowStepInput }
  | { id: string; kind: 'branch'; x: number; y: number; width: number; height: number; step: WorkflowStepInput }
  | { id: string; kind: 'add'; x: number; y: number; width: number; height: number; insert: InsertAt };

/** A "+" that sits on an edge and inserts a step there. */
export interface EdgeAdd {
  at: InsertAt;
  /** Where along the edge the button sits. */
  anchor: 'middle' | 'source' | 'target';
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  /** Which lane a branch edge leaves from. */
  lane?: 'yes' | 'no';
  adds: EdgeAdd[];
}

export interface WorkflowLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

/** How wide a list renders: a branch is as wide as both of its lanes side by side. */
const measure = (steps: WorkflowStepInput[]): number =>
  steps.reduce(
    (width, step) => (step.kind === 'branch' ? Math.max(width, measure(step.yes) + GAP_X + measure(step.no)) : width),
    NODE_WIDTH,
  );

/** Every step needs an id on the canvas; the editor assigns them before layout. */
const idOf = (step: WorkflowStepInput): string => step.id ?? '';

const isAdd = (id: string): boolean => id.startsWith('add:');

interface Laid {
  /** The first node of the list, for the edge coming in. */
  entry: string;
  /** Where the list ends: the nodes whatever follows the list attaches to (several after a branch). */
  exits: string[];
  bottom: number;
}

/**
 * Lay a tree out top-down. A list that nothing follows ends in a round "+"; a branch at the end of it ends in
 * its lanes instead. Lanes only merge when steps follow the branch.
 */
export const layoutWorkflow = (steps: WorkflowStepInput[]): WorkflowLayout => {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const width = Math.max(measure(steps), NODE_WIDTH);
  const centerX = width / 2;

  const connect = (source: string, target: string, adds: EdgeAdd[], lane?: 'yes' | 'no') => {
    edges.push({ id: `e${edges.length + 1}`, source, target, adds, ...(lane ? { lane } : {}) });
  };

  /** The edges into the next step of a list from where the previous one ended. */
  const follow = (exits: string[], target: string, branch: string | undefined) => {
    exits.forEach((source, index) => {
      const adds: EdgeAdd[] = [];

      if (exits.length > 1) {
        // Lanes merging: a "+" under each lane end adds to that lane, one above the step adds right after the branch.
        if (!isAdd(source)) {
          adds.push({ at: { kind: 'after', id: source }, anchor: 'source' });
        }

        if (index === 0 && branch) {
          adds.push({ at: { kind: 'after', id: branch }, anchor: 'target' });
        }
      } else if (!isAdd(source) && !isAdd(target)) {
        adds.push({ at: { kind: 'after', id: source }, anchor: 'middle' });
      }

      connect(source, target, adds);
    });
  };

  /** `closed`: something follows this list, so it does not end in a "+" of its own. */
  const layoutList = (list: WorkflowStepInput[], cx: number, top: number, closed: boolean, empty: InsertAt): Laid => {
    let y = top;
    let bottom = top;
    let entry: string | undefined;
    let exits: string[] = [];
    let joined: string | undefined;
    const attach = (id: string) => {
      if (entry === undefined) {
        entry = id;
      } else {
        follow(exits, id, joined);
      }

      joined = undefined;
    };
    list.forEach((step, index) => {
      const id = idOf(step);
      const last = index === list.length - 1;

      if (step.kind === 'branch') {
        nodes.push({ id, kind: 'branch', x: cx - NODE_WIDTH / 2, y, width: NODE_WIDTH, height: NODE_HEIGHT, step });
        attach(id);
        const laneTop = y + NODE_HEIGHT + LANE_GAP;
        const yesWidth = measure(step.yes);
        const noWidth = measure(step.no);
        const total = yesWidth + GAP_X + noWidth;
        const laneClosed = closed || !last;
        const yes = layoutList(step.yes, cx - total / 2 + yesWidth / 2, laneTop, laneClosed, {
          kind: 'lane',
          branch: id,
          lane: 'yes',
        });
        const no = layoutList(step.no, cx + total / 2 - noWidth / 2, laneTop, laneClosed, {
          kind: 'lane',
          branch: id,
          lane: 'no',
        });

        for (const [lane, laid] of [
          ['yes', yes],
          ['no', no],
        ] as const) {
          const adds: EdgeAdd[] = isAdd(laid.entry)
            ? []
            : [{ at: { kind: 'lane', branch: id, lane }, anchor: 'target' }];
          connect(id, laid.entry, adds, lane);
        }

        exits = [...yes.exits, ...no.exits];
        joined = id;
        bottom = Math.max(yes.bottom, no.bottom);
        y = bottom + MERGE_GAP;
      } else {
        nodes.push({ id, kind: 'step', x: cx - NODE_WIDTH / 2, y, width: NODE_WIDTH, height: NODE_HEIGHT, step });
        attach(id);
        exits = [id];
        bottom = y + NODE_HEIGHT;
        y = bottom + GAP_Y;
      }
    });
    const lastStep = list[list.length - 1];

    if (!lastStep || (!closed && lastStep.kind !== 'branch')) {
      // An empty list is its own "+"; a list nothing follows ends in one, unless it ends in a branch whose lanes do.
      const insert: InsertAt = lastStep ? { kind: 'after', id: idOf(lastStep) } : empty;
      const addId = `add:${insert.kind === 'after' ? insert.id : insert.kind === 'lane' ? `${insert.branch}:${insert.lane}` : insert.kind}`;
      const addY = lastStep ? bottom + GAP_ADD : top;
      nodes.push({
        id: addId,
        kind: 'add',
        x: cx - ADD_SIZE / 2,
        y: addY,
        width: ADD_SIZE,
        height: ADD_SIZE,
        insert,
      });
      attach(addId);
      exits = [addId];
      bottom = addY + ADD_SIZE;
    }

    return { entry: entry ?? '', exits, bottom };
  };

  nodes.push({
    id: 'trigger',
    kind: 'trigger',
    x: centerX - NODE_WIDTH / 2,
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  });
  const root = layoutList(steps, centerX, NODE_HEIGHT + GAP_Y, false, { kind: 'end' });
  connect('trigger', root.entry, isAdd(root.entry) ? [] : [{ at: { kind: 'start' }, anchor: 'middle' }]);

  return { nodes, edges, width, height: root.bottom };
};
