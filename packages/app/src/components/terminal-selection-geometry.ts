export type SelectionHandleSide = "start" | "end"

export type SelectionCell = { x: number; y: number }
export type SelectionRange = { start: SelectionCell; end: SelectionCell }
export type SelectionRect = { left: number; top: number; width: number; height: number }
export type SelectionHandlePoint = { clientX: number; clientY: number; overlayLeft: number; overlayTop: number }
export type SelectionGeometry = { start: SelectionHandlePoint; end: SelectionHandlePoint }
export type SelectionGeometryInput = {
  range: SelectionRange
  canvasRect: SelectionRect
  containerRect: Pick<SelectionRect, "left" | "top">
  columns: number
  rows: number
}

export function selectionGeometry(input: SelectionGeometryInput): SelectionGeometry | undefined {
  if (input.columns <= 0 || input.rows <= 0) return undefined
  if (input.canvasRect.width <= 0 || input.canvasRect.height <= 0) return undefined
  const cellWidth = input.canvasRect.width / input.columns
  const cellHeight = input.canvasRect.height / input.rows
  return {
    start: handlePoint(input, input.range.start, "start", cellWidth, cellHeight),
    end: handlePoint(input, input.range.end, "end", cellWidth, cellHeight),
  }
}

function handlePoint(
  input: SelectionGeometryInput,
  cell: SelectionCell,
  side: SelectionHandleSide,
  cellWidth: number,
  cellHeight: number,
): SelectionHandlePoint {
  const edgeX = cell.x + (side === "end" ? 1 : 0)
  const bottomY = (cell.y + 1) * cellHeight
  return {
    clientX: input.canvasRect.left + (cell.x + 0.5) * cellWidth,
    clientY: input.canvasRect.top + (cell.y + 0.5) * cellHeight,
    overlayLeft: input.canvasRect.left - input.containerRect.left + edgeX * cellWidth,
    overlayTop: input.canvasRect.top - input.containerRect.top + bottomY,
  }
}