export interface DistrictConfig {
  id: string;
  name: string;
  state: string;
  classlink: {
    loginUrl: string;
    tenant: string;
  };
  schoology: {
    domain: string;
    enabled: boolean;
  };
  infiniteCampus: {
    baseUrl: string;
    appName: string;
    enabled: boolean;
  };
}

export const DISTRICTS: Record<string, DistrictConfig> = {
  pausd: {
    id: 'pausd',
    name: 'Palo Alto Unified School District',
    state: 'CA',
    classlink: { loginUrl: 'https://launchpad.classlink.com/pausd', tenant: 'pausd' },
    schoology: { domain: 'pausd.schoology.com', enabled: true },
    infiniteCampus: { baseUrl: 'https://pausd.infinitecampus.org', appName: 'campus', enabled: true },
  },
  srvusd: {
    id: 'srvusd',
    name: 'San Ramon Valley Unified School District',
    state: 'CA',
    classlink: { loginUrl: 'https://launchpad.classlink.com/srvusd', tenant: 'srvusd' },
    schoology: { domain: 'srvusd.schoology.com', enabled: true },
    infiniteCampus: { baseUrl: 'https://srvusd.infinitecampus.org', appName: 'campus', enabled: true },
  },
  dasd: {
    id: 'dasd',
    name: 'Downingtown Area School District',
    state: 'PA',
    classlink: { loginUrl: 'https://launchpad.classlink.com/dasd', tenant: 'dasd' },
    schoology: { domain: 'dasd.schoology.com', enabled: true },
    infiniteCampus: { baseUrl: 'https://dasd.infinitecampus.org', appName: 'campus', enabled: true },
  },
  shakopee: {
    id: 'shakopee',
    name: 'Shakopee Public Schools',
    state: 'MN',
    classlink: { loginUrl: 'https://launchpad.classlink.com/shakopee', tenant: 'shakopee' },
    schoology: { domain: '', enabled: false },
    infiniteCampus: { baseUrl: 'https://shakopee.infinitecampus.org', appName: 'campus', enabled: true },
  },
  norristown: {
    id: 'norristown',
    name: 'Norristown Area School District',
    state: 'PA',
    classlink: { loginUrl: 'https://launchpad.classlink.com/norristown', tenant: 'norristown' },
    schoology: { domain: 'norristown.schoology.com', enabled: true },
    infiniteCampus: { baseUrl: 'https://nasd.infinitecampus.org', appName: 'campus', enabled: true },
  },
  fulton: {
    id: 'fulton',
    name: 'Fulton County Schools',
    state: 'GA',
    classlink: { loginUrl: 'https://launchpad.classlink.com/fulton', tenant: 'fulton' },
    schoology: { domain: 'fultonschools.schoology.com', enabled: true },
    infiniteCampus: { baseUrl: 'https://fultonschools.infinitecampus.org', appName: 'campus', enabled: true },
  },
  d303: {
    id: 'd303',
    name: 'St. Charles CUSD 303',
    state: 'IL',
    classlink: { loginUrl: 'https://launchpad.classlink.com/d303', tenant: 'd303' },
    schoology: { domain: 'd303.schoology.com', enabled: true },
    infiniteCampus: { baseUrl: 'https://d303.infinitecampus.org', appName: 'campus', enabled: false },
  },
};

export function getDistrict(districtId: string): DistrictConfig {
  const config = DISTRICTS[districtId];
  if (!config) {
    throw new Error(`Unknown district: "${districtId}". Add it to districtConfig.ts.`);
  }
  return config;
}

export function listDistricts(): { id: string; name: string; state: string }[] {
  return Object.values(DISTRICTS).map(({ id, name, state }) => ({ id, name, state }));
}
