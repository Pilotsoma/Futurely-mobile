// Static HAC district list — mirrors lib/isds.ts on web (the source of truth),
// filtered to entries that have an hacUrl (Canvas/ClassLink-only districts are
// out of scope for mobile; see melodic-wobbling-pillow.md). Web's own HAC picker
// uses this same static list rather than a live search endpoint, so mobile does too.

export interface ISDEntry {
  name: string
  state: string
  hacUrl: string
}

export const ISD_LIST: ISDEntry[] = [
  // Texas
  { name: 'Aldine ISD', state: 'TX', hacUrl: 'https://hac.aldineisd.org' },
  { name: 'Allen ISD', state: 'TX', hacUrl: 'https://hac.allenisd.org' },
  { name: 'Alvin ISD', state: 'TX', hacUrl: 'https://homeaccess.alvinisd.net' },
  { name: 'Brenham ISD', state: 'TX', hacUrl: 'https://hac.bisd.us' },
  { name: 'Burleson ISD', state: 'TX', hacUrl: 'https://hac.burlesonisd.net' },
  { name: 'Canutillo ISD', state: 'TX', hacUrl: 'https://hac.canutillo-isd.org' },
  { name: 'Cedar Hill ISD', state: 'TX', hacUrl: 'https://hac.chisd.net' },
  { name: 'College Station ISD', state: 'TX', hacUrl: 'https://hac.csisd.org' },
  { name: 'Conroe ISD', state: 'TX', hacUrl: 'https://hac.conroeisd.net' },
  { name: 'Corpus Christi ISD', state: 'TX', hacUrl: 'https://hac.ccisd.us' },
  { name: 'Cypress-Fairbanks ISD', state: 'TX', hacUrl: 'https://home-access.cfisd.net' },
  { name: 'Denton ISD', state: 'TX', hacUrl: 'https://denhac.dentonisd.org' },
  { name: 'DeSoto ISD', state: 'TX', hacUrl: 'https://hac.desotoisd.org' },
  { name: 'Duncanville ISD', state: 'TX', hacUrl: 'https://hac.duncanvilleisd.org' },
  { name: 'Ector County ISD (Odessa)', state: 'TX', hacUrl: 'https://hac.ectorcountyisd.org' },
  { name: 'Frisco ISD', state: 'TX', hacUrl: 'https://hac.friscoisd.org' },
  { name: 'Georgetown ISD', state: 'TX', hacUrl: 'https://hac.georgetownisd.org' },
  { name: 'Harlandale ISD', state: 'TX', hacUrl: 'https://hac.harlandale.net' },
  { name: 'Humble ISD', state: 'TX', hacUrl: 'https://homeaccess.humbleisd.net' },
  { name: 'Irving ISD', state: 'TX', hacUrl: 'https://esphac.irvingisd.net' },
  { name: 'Katy ISD', state: 'TX', hacUrl: 'https://homeaccess.katyisd.org' },
  { name: 'Killeen ISD', state: 'TX', hacUrl: 'https://esphac.killeenisd.org' },
  { name: 'La Joya ISD', state: 'TX', hacUrl: 'https://hac.lajoyaisd.com' },
  { name: 'Leander ISD', state: 'TX', hacUrl: 'https://hac.leanderisd.org' },
  { name: 'Magnolia ISD', state: 'TX', hacUrl: 'https://hac.magnoliaisd.org' },
  { name: 'Mansfield ISD', state: 'TX', hacUrl: 'https://hac.mansfieldisd.org' },
  { name: 'McKinney ISD', state: 'TX', hacUrl: 'https://hac.mckinneyisd.net' },
  { name: 'Midland ISD', state: 'TX', hacUrl: 'https://hac.midlandisd.net' },
  { name: 'Nacogdoches ISD', state: 'TX', hacUrl: 'https://hac.nacisd.org' },
  { name: 'New Braunfels ISD', state: 'TX', hacUrl: 'https://hac.nbisd.org' },
  { name: 'Northside ISD (San Antonio)', state: 'TX', hacUrl: 'https://hac.nisd.net' },
  { name: 'Northwest ISD (Fort Worth)', state: 'TX', hacUrl: 'https://hac.nisdtx.org' },
  { name: 'Pharr-San Juan-Alamo ISD', state: 'TX', hacUrl: 'https://homeaccess.psjaisd.us' },
  { name: 'Pflugerville ISD', state: 'TX', hacUrl: 'https://hac.pfisd.net' },
  { name: 'Round Rock ISD', state: 'TX', hacUrl: 'https://accesscenter.roundrockisd.org' },
  { name: 'San Marcos CISD', state: 'TX', hacUrl: 'https://hac.smcisd.net' },
  { name: 'Seguin ISD', state: 'TX', hacUrl: 'https://hac.seguin-isd.org' },
  { name: 'Tomball ISD', state: 'TX', hacUrl: 'https://grades.tomballisd.net' },
  { name: 'Tyler ISD', state: 'TX', hacUrl: 'https://hac.tylerisd.org' },
  { name: 'Waco ISD', state: 'TX', hacUrl: 'https://hac.wacoisd.org' },
  { name: 'Willis ISD', state: 'TX', hacUrl: 'https://hac.willisisd.org' },
  { name: 'Wylie ISD (Abilene area)', state: 'TX', hacUrl: 'https://hac.wylieisd.net' },

  // Maryland
  { name: 'Harford County Public Schools', state: 'MD', hacUrl: 'https://hac.hcps.org' },

  // Washington
  { name: 'Puyallup School District', state: 'WA', hacUrl: 'https://homeaccess.puyallup.k12.wa.us' },

  // Delaware
  { name: 'Delaware Public Schools (statewide)', state: 'DE', hacUrl: 'https://hacdoe.doe.k12.de.us' },

  // Kansas
  { name: 'Blue Valley USD 229', state: 'KS', hacUrl: 'https://hac.bluevalleyk12.org' },
  { name: 'Shawnee Mission USD 512', state: 'KS', hacUrl: 'https://hac.smsd.org' },
  { name: 'Olathe USD 233', state: 'KS', hacUrl: 'https://hac.olatheschools.com' },
  { name: 'Wichita USD 259', state: 'KS', hacUrl: 'https://hac.usd259.org' },
  { name: 'Derby USD 260', state: 'KS', hacUrl: 'https://hac.derbyschools.com' },

  // Oklahoma
  { name: 'Edmond Public Schools', state: 'OK', hacUrl: 'https://hac.edmondschools.net' },
  { name: 'Yukon Public Schools', state: 'OK', hacUrl: 'https://hac.yukonisd.net' },
  { name: 'Moore Public Schools', state: 'OK', hacUrl: 'https://hac.mooreschools.com' },
  { name: 'Jenks Public Schools', state: 'OK', hacUrl: 'https://hac.jenksps.org' },
  { name: 'Broken Arrow Public Schools', state: 'OK', hacUrl: 'https://hac.baps.net' },
]

export const SORTED_ISD_LIST: ISDEntry[] = [...ISD_LIST].sort((a, b) => {
  if (a.state !== b.state) return a.state.localeCompare(b.state)
  return a.name.localeCompare(b.name)
})
