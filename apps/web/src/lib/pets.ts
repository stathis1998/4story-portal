// Every pet a companion rune summons, from the game's item chart (TITEMCHART bType 22) as of 2026-11-13. The pet is the
// rune's max durability, a monster id; names are the client's monster names (TMon.tcd). looks are files in
// public/pet-models, one per monster: runes that share a name summon the same pet in different colours.
// The plain Companion Rune (17013) has no fixed pet, and the Tarantula fossils are not in the client, so neither is here.

export type Pet = {
  name: string
  /** The rune's icon, a sprite in public/game-icons. */
  icon: number
  runes: readonly string[]
  looks: readonly number[]
  /** False when the server's TMONSTERCHART lacks the pet, so using the rune does nothing. */
  summonable: boolean
}

const RUNE_ICON = 10695

export const PETS: readonly Pet[] = [
  { name: 'Behemoth Whelp', icon: RUNE_ICON, runes: ['Behemoth Rune'], looks: [31132, 31151, 31152], summonable: true },
  { name: "Bermaga's Soul", icon: 12412, runes: ['Snake Spirit Rune'], looks: [16495], summonable: true },
  { name: 'Bouncing Bunny', icon: 12478, runes: ['Bouncing Bunny Rune'], looks: [31177], summonable: true },
  { name: 'Crab', icon: RUNE_ICON, runes: ['Crab Rune'], looks: [31127, 31145, 31146], summonable: true },
  { name: 'Derion Dragon Guard', icon: RUNE_ICON, runes: ['Water Drake Rune'], looks: [30755], summonable: true },
  { name: 'Drake', icon: RUNE_ICON, runes: ['Drake Rune'], looks: [31129], summonable: true },
  { name: 'Easter Squirrel', icon: 12468, runes: ['Easter Squirrel Rune'], looks: [31175], summonable: false },
  { name: 'Gor Hen', icon: RUNE_ICON, runes: ['Gor Hen Rune'], looks: [31131, 31149, 31150], summonable: true },
  { name: 'Grieving Spirit', icon: RUNE_ICON, runes: ['Grieving Spirit Rune'], looks: [31552], summonable: true },
  { name: 'Hell Guard Bedik', icon: RUNE_ICON, runes: ['Behemoth Rune'], looks: [16066], summonable: true },
  { name: 'Hornet Queen', icon: RUNE_ICON, runes: ['Gift of the Gods - Bee Queen'], looks: [295], summonable: true },
  { name: 'Humpty Dumpty', icon: 12462, runes: ['Humpty Dumpty Rune'], looks: [31176], summonable: false },
  { name: 'Iron Lamb', icon: RUNE_ICON, runes: ['Iron Lamb Rune'], looks: [31130, 31147, 31148], summonable: true },
  { name: 'Merciless Slaughterer', icon: RUNE_ICON, runes: ['Empusa Rune'], looks: [3515], summonable: true },
  { name: 'Minitaurus', icon: RUNE_ICON, runes: ['Minitaur Rune'], looks: [31126], summonable: true },
  { name: 'Obsidian Dragon Whelp', icon: 12456, runes: ['Obsidian Dragon Whelp Rune'], looks: [31173], summonable: true },
  { name: 'Pearl Dragon Whelp', icon: 12457, runes: ['Pearl Dragon Whelp Rune'], looks: [31174], summonable: true },
  { name: 'Poison-Tail Dokatumen', icon: RUNE_ICON, runes: ['Dokatumen Rune'], looks: [15794], summonable: true },
  { name: 'Sapphire Dragon Whelp', icon: 12455, runes: ['Sapphire Dragon Whelp Rune'], looks: [31172], summonable: true },
  { name: 'Snow Kitsune Cub', icon: 12454, runes: ['Snow Kitsune Cub Rune'], looks: [31169], summonable: true },
  { name: 'Spots', icon: 12470, runes: ['Spots Rune'], looks: [31178], summonable: true },
  { name: 'Squirrel', icon: 12411, runes: ['Squirrel Rune'], looks: [23001], summonable: true },
  { name: 'Suckling', icon: RUNE_ICON, runes: ['Suckling Rune'], looks: [31125, 31143, 31144], summonable: true },
  { name: 'Titan', icon: RUNE_ICON, runes: ['Titan Rune'], looks: [31736], summonable: true },
  { name: 'Valorian Dragon Guard', icon: RUNE_ICON, runes: ['Magma Drake Rune'], looks: [30753], summonable: true },
  { name: 'Victor', icon: RUNE_ICON, runes: ['Victor Rune'], looks: [31128], summonable: true },
  { name: 'Zombie Dragon', icon: RUNE_ICON, runes: ['Companion Rune', 'Zombie Dragon Rune'], looks: [31141], summonable: true },
]
