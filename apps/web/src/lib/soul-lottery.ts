/**
 * The game's soul lottery, from OnCS_SOULLOTTERY_REQ and OnCS_SOULLOTTERY_TRIGGER_REQ in the map server.
 * Runs in the browser and changes nothing in the game.
 */

/** TLEVELCHART.dwMoney for levels 1 to 90, as of 9 November 2026. */
const LEVEL_BASE_COPPER = [
  1, 13, 79, 211, 475, 814, 1346, 2002, 2886, 3960, 5236, 6727, 8500, 10524, 12812, 15378, 18444, 21617, 25027, 28925, 33176, 37514, 42688,
  47766, 53750, 59510, 66237, 72824, 80449, 88044, 96096, 104073, 113484, 123420, 132545, 143374, 153331, 165079, 177399, 189446, 201872,
  215758, 228228, 243122, 258456, 274428, 288824, 305650, 323136, 340216, 357720, 376767, 396510, 416961, 435283, 456654, 478755, 501349,
  521628, 545419, 569976, 595042, 620892, 643658, 670489, 698126, 726290, 755277, 780612, 810612, 841456, 872845, 904780, 933086, 966380,
  1000230, 1034968, 1070269, 1106476, 1140823, 1140823, 1140823, 1140823, 1140823, 1140823, 1140823, 1140823, 1140823, 1140823, 1140823,
]

export const MAX_LOTTERY_LEVEL = LEVEL_BASE_COPPER.length

const PRIZE_MULTIPLIER = 138
const CONSOLATION_COPPER_PER_LEVEL = 1000
const COPPER_PER_SILVER = 1000
const COPPER_PER_GOLD = 1_000_000

export type SoulLotteryRoll = {
  numbers: number[]
  drawn: number
  won: boolean
  /** What a win would have paid. */
  prize: number
  /** What this lottery actually paid. */
  copper: number
}

/** Draws in the same order as the server, and keeps its rand() limit of 32767 so the spread of prizes matches too. */
export function rollSoulLottery(level: number, random: () => number = Math.random): SoulLotteryRoll {
  const rand = () => Math.floor(random() * 32768)
  const number = () => (rand() % 30) + 1

  const numbers: number[] = []
  while (numbers.length < 4) {
    const candidate = number()
    if (!numbers.includes(candidate)) numbers.push(candidate)
  }

  const base = LEVEL_BASE_COPPER[level - 1]
  const range = base * ((rand() % 100) + 1)
  const prize = ((rand() % range) + base) * PRIZE_MULTIPLIER

  const drawn = number()
  const won = numbers.includes(drawn)

  return { numbers, drawn, won, prize, copper: won ? prize : level * CONSOLATION_COPPER_PER_LEVEL }
}

/** Shows copper as `12g 340s 56c`, leaving out the parts that are zero. */
export function formatCopper(copper: number): string {
  const parts = [
    [Math.floor(copper / COPPER_PER_GOLD), 'g'],
    [Math.floor(copper / COPPER_PER_SILVER) % COPPER_PER_SILVER, 's'],
    [copper % COPPER_PER_SILVER, 'c'],
  ] as const

  return (
    parts
      .filter(([amount]) => amount > 0)
      .map(([amount, unit]) => `${amount}${unit}`)
      .join(' ') || '0c'
  )
}
