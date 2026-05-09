var config = require('v2.config');
var intel = require('v2.intel');
var tasks = require('v2.tasks');
var utils = require('v2.utils');

function getBody(role, energy) {
    if(role == config.roles.scout) {
        return [MOVE];
    }

    if(role == config.roles.collector) {
        if(energy >= 500) {
            return [WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
        }
        if(energy >= 350) {
            return [WORK, CARRY, CARRY, MOVE, MOVE];
        }
        if(energy >= 300) {
            return [WORK, CARRY, MOVE, MOVE];
        }
        return [WORK, CARRY, MOVE];
    }

    if(energy >= 550) {
        return [WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE];
    }
    if(energy >= 400) {
        return [WORK, WORK, CARRY, MOVE, MOVE];
    }
    return [WORK, CARRY, MOVE];
}

function getBodyCost(body) {
    var cost = 0;
    for(var i = 0; i < body.length; i++) {
        cost += BODYPART_COST[body[i]];
    }
    return cost;
}

function chooseRole(spawn) {
    var miners = tasks.countRole(config.roles.miner);
    var collectors = tasks.countRole(config.roles.collector);
    var scouts = tasks.countRole(config.roles.scout);
    var minerTarget = tasks.desiredMinerCount();
    var collectorTarget = tasks.desiredCollectorCount();

    if(miners === 0) {
        return config.roles.miner;
    }

    if(collectors < Math.min(miners, collectorTarget)) {
        return config.roles.collector;
    }

    if(miners < minerTarget) {
        return config.roles.miner;
    }

    if(intel.getUnknownScoutTargets().length > 0 && scouts < config.maxScouts) {
        return config.roles.scout;
    }

    if(collectors < collectorTarget) {
        return config.roles.collector;
    }

    if(spawn.room.energyAvailable < spawn.room.energyCapacityAvailable &&
        collectors < miners + 1) {
        return config.roles.collector;
    }

    return config.roles.miner;
}

function run() {
    var spawns = utils.getAllSpawns();
    for(var i = 0; i < spawns.length; i++) {
        var spawn = spawns[i];
        if(spawn.spawning) {
            continue;
        }

        var role = chooseRole(spawn);
        var body = getBody(role, spawn.room.energyAvailable);
        if(getBodyCost(body) > spawn.room.energyAvailable) {
            continue;
        }

        spawn.spawnCreep(body, role + '_' + Game.time + '_' + i, {
            memory: {
                role: role,
                bornRoom: spawn.room.name
            }
        });
    }
}

module.exports = {
    run: run
};
