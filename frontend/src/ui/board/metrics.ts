export const baseMetrics = {
  columnWidth: 260,
  columnGap: 0,
  laneHeaderWidth: 120,
  headerHeight: 40,
  laneTitleHeight: 32,
  laneGap: 0,
  cellPadding: 12,
  cardGap: 10,
  boardPaddingBottom: 24,
};

export function getMetrics(fontSize: number) {
  const metaFontSize = Math.max(10, fontSize - 2);
  const cardBaseHeight = 8 + fontSize + 9 + metaFontSize + 7 + metaFontSize + 16;
  return {
    ...baseMetrics,
    cardBaseHeight,
    subtaskHeight: fontSize + 12,
  };
}
