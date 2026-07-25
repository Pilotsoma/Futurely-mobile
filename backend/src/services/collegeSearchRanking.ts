/**
 * Ranks College Scorecard search results for relevance against the user's query.
 *
 * Scorecard's own name filter is a plain substring match with no relevance
 * ordering, so a query like "MIT" returns dozens of "Paul Mitchell the School"
 * cosmetology campuses (which contain "Mit" from "Mitchell") ahead of the actual
 * Massachusetts Institute of Technology. This ranks results so that:
 *
 * 1. Exact acronym matches (computed from the school's own name) sort first —
 *    this is what makes "MIT" resolve to Massachusetts Institute of Technology
 *    and "UTD" resolve to University of Texas at Dallas, generically, for any
 *    school, without a hardcoded per-school lookup table.
 * 2. Names that start with the query sort next.
 * 3. Names containing the query as a whole word sort next.
 * 4. Everything else (generic substring matches) sorts last.
 *
 * Ties within a tier break by enrollment size descending (larger, better-known
 * schools first), then alphabetically.
 */

const ACRONYM_STOPWORDS = new Set(['of', 'the', 'at', 'and', 'in', 'for', 'a', 'an'])

export interface RankableSchool {
  name: string
  enrollment: number | null
}

/**
 * Computes a school's acronym from its official name by taking the first letter
 * of each significant word (skipping short stopwords like "of" and "the").
 *
 * e.g. "Massachusetts Institute of Technology" -> "MIT"
 *      "University of Texas at Dallas" -> "UTD"
 *      "University of California, Los Angeles" -> "UCLA"
 */
export function computeAcronym(name: string): string {
  return name
    .replace(/[^a-zA-Z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .filter(word => !ACRONYM_STOPWORDS.has(word.toLowerCase()))
    .map(word => word[0])
    .join('')
    .toUpperCase()
}

function relevanceTier(name: string, normalizedQuery: string): number {
  const normalizedName = name.toLowerCase()

  if (computeAcronym(name) === normalizedQuery.toUpperCase()) return 0
  if (normalizedName.startsWith(normalizedQuery)) return 1
  if (new RegExp(`\\b${escapeRegExp(normalizedQuery)}`, 'i').test(name)) return 2
  return 3
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Sorts search results by relevance to the query. Mutates nothing — returns a
 * new sorted array.
 */
export function rankSearchResults<T extends RankableSchool>(results: T[], query: string): T[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return results

  return [...results].sort((a, b) => {
    const tierA = relevanceTier(a.name, normalizedQuery)
    const tierB = relevanceTier(b.name, normalizedQuery)
    if (tierA !== tierB) return tierA - tierB

    const enrollmentA = a.enrollment ?? -1
    const enrollmentB = b.enrollment ?? -1
    if (enrollmentA !== enrollmentB) return enrollmentB - enrollmentA

    return a.name.localeCompare(b.name)
  })
}
