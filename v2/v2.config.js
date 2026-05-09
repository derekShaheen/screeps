module.exports = {
    memoryKey: 'v2',

    roles: {
        miner: 'miner',
        collector: 'collector',
        scout: 'scout'
    },

    hostileTicks: 10000,
    staleRoomTicks: 3000,
    roadUsageDecay: 0.995,
    pathUsageDecay: 0.99,
    minMinersPerSpawn: 4,
    collectorUpgradeRatio: 0.25,
    maxScouts: 2,
    maxConstructionSitesPerTick: 5,
    mapVisualEnabled: true
};
