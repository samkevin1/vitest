export class Volume {
  constructor(public amount: number, public unit: 'L' | 'mL') {}

  equals(other: Volume): boolean {
    if (this.unit === other.unit)
      return this.amount === other.amount
    else if (this.unit === 'L' && other.unit === 'mL')
      return this.amount * 1000 === other.amount
    else
      return this.amount === other.amount * 1000
  }
}
