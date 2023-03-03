import { expect } from 'vitest'
import { Volume } from './Volume'

function isVolume(a: unknown): a is Volume {
  return a instanceof Volume
}

function areVolumesEqual(a: unknown, b: unknown): boolean | undefined {
  const isAVolume = isVolume(a)
  const isBVolume = isVolume(b)

  if (isAVolume && isBVolume)
    return a.equals(b)
  else if (isAVolume !== isBVolume)
    return false
  else
    return undefined
}

expect.addEqualityTesters([areVolumesEqual])
