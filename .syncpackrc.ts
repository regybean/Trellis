// @ts-check

/** @type {import("syncpack").RcFile} */
const config = {
  versionGroups: [
    {
      label: 'Use workspace protocol when developing local packages',
      dependencies: ['$LOCAL'],
      dependencyTypes: ['!local'],
      pinVersion: 'workspace:*'
    }
  ]
};

module.exports = config;