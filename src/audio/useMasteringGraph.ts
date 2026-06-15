import { useCallback, useEffect, useRef, useState } from 'react'
import { MasteringGraph } from './realtimeGraph'
import type { MasteringChain } from './types'

/**
 * Owns the realtime MasteringGraph lifecycle for an <audio> element.
 * The graph (and its AudioContext) is built lazily on the first play gesture.
 */
export function useMasteringGraph(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  chain: MasteringChain,
  mode: 'before' | 'after',
) {
  const graphRef = useRef<MasteringGraph | null>(null)
  const [ready, setReady] = useState(false)

  const ensureStarted = useCallback(async () => {
    if (!audioRef.current) return
    if (!graphRef.current) graphRef.current = new MasteringGraph(audioRef.current)
    await graphRef.current.ensureStarted()
    setReady(true)
  }, [audioRef])

  // Push chain / bypass changes into the live graph.
  useEffect(() => {
    const g = graphRef.current
    if (g && g.ready) g.update(chain, mode === 'before')
  }, [chain, mode, ready])

  // Tear down on unmount.
  useEffect(
    () => () => {
      graphRef.current?.dispose()
      graphRef.current = null
    },
    [],
  )

  return { graph: graphRef.current, ready, ensureStarted }
}
