import type { ChartPoint } from '../components/SvgLineChart.vue'

/**
 * Largest Triangle Three Buckets (LTTB) 降采样算法。
 * 将数据点按 X 轴顺序分桶，每桶选取与前后桶中心构成最大三角形面积的点，
 * 从而在减少点数的同时最大程度保留折线的视觉形状特征。
 */
export function downsampleLTTB(points: ChartPoint[], target: number): ChartPoint[] {
  if (points.length <= target || target < 3) return points

  const result: ChartPoint[] = []
  const firstPoint = points[0]
  if (!firstPoint) return points
  result.push(firstPoint)

  const bucketSize = (points.length - 2) / (target - 2)

  let prevSelectedIndex = 0

  for (let i = 1; i < target - 1; i++) {
    const bucketStart = Math.floor((i - 1) * bucketSize) + 1
    const bucketEnd = Math.min(Math.floor(i * bucketSize) + 1, points.length - 1)
    const nextBucketStart = Math.floor(i * bucketSize) + 1
    const nextBucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, points.length - 1)

    let avgX = 0
    let avgY = 0
    let count = 0
    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      const pt = points[j]
      if (!pt) continue
      avgX += pt.x
      avgY += pt.y
      count++
    }
    if (count > 0) {
      avgX /= count
      avgY /= count
    } else {
      const fallback = points[nextBucketStart]
      if (fallback) {
        avgX = fallback.x
        avgY = fallback.y
      }
    }

    const prev = points[prevSelectedIndex]
    if (!prev) continue
    let maxArea = -1
    let bestIndex = bucketStart

    for (let j = bucketStart; j < bucketEnd; j++) {
      const pt = points[j]
      if (!pt) continue
      const area = Math.abs(
        (prev.x - avgX) * (pt.y - prev.y)
        - (prev.x - pt.x) * (avgY - prev.y),
      ) * 0.5
      if (area > maxArea) {
        maxArea = area
        bestIndex = j
      }
    }

    const bestPoint = points[bestIndex]
    if (bestPoint) {
      result.push(bestPoint)
      prevSelectedIndex = bestIndex
    }
  }

  const lastPoint = points[points.length - 1]
  if (lastPoint) {
    result.push(lastPoint)
  }
  return result
}
