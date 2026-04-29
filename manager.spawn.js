var debug = require('utils.debug');

var BASE_TARGETS = {
    harvester: 2,
    upgrader: 1,
    builder: 1,
    defender: 1
};

var ROLE_PRIORITY = ['harvester', 'upgrader', 'builder', 'defender'];

var BODIES = {
    harvester: [
        [WORK, CARRY, MOVE],
        [WORK, WORK, CARRY, MOVE],
        [WORK, WORK, CARRY, CARRY, MOVE],
        [WORK, WORK, CARRY, CARRY, MOVE, MOVE]
    ],
    upgrader: [
        [WORK, CARRY, MOVE],
        [WORK, CARRY, CARRY, MOVE],
        [WORK, WORK, CARRY, MOVE, MOVE],
        [WORK, WORK, CARRY, CARRY, MOVE, MOVE]
    ],
    builder: [
        [WORK, CARRY, MOVE],
        [WORK, CARRY, CARRY, MOVE],
        [WORK, WORK, CARRY, MOVE, MOVE],
        [WORK, WORK, CARRY, CARRY, MOVE, MOVE]
    ],
    defender: [
        [ATTACK, ATTACK, MOVE],
        [TOUGH, ATTACK, ATTACK, MOVE],
        [TOUGH, ATTACK, ATTACK, MOVE, MOVE]
    ]
};

function bodyCost(body) {
    var cost = 0;
    for(var i = 0; i < body.length; i++) {
        cost += BODYPART_COST[body[i]];
    }

    return cost;
}

function chooseBody(room, role) {
    var options = BODIES[role] || BODIES.harvester;
    for(var i = options.length - 1; i >= 0; i--) {
        if(bodyCost(options[i]) <= room.energyAvailable) {
            return options[i];
        }
    }

    return null;
}

function countRoles(room) {
    var counts = {
        harvester: 0,
        upgrader: 0,
        builder: 0,
        defender: 0
    };

    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.room.name != room.name) {
            continue;
        }

        if(counts[creep.memory.role] !== undefined) {
            counts[creep.memory.role]++;
        }
    }

    return counts;
}

function getMinimumTargets(room) {
    var memoryTargets = room.memory.creepTargets || BASE_TARGETS;
    return {
        harvester: memoryTargets.harvester === undefined ? BASE_TARGETS.harvester : memoryTargets.harvester,
        upgrader: memoryTargets.upgrader === undefined ? BASE_TARGETS.upgrader : memoryTargets.upgrader,
        builder: memoryTargets.builder === undefined ? BASE_TARGETS.builder : memoryTargets.builder,
        defender: memoryTargets.defender === undefined ? BASE_TARGETS.defender : memoryTargets.defender
    };
}

function countStructures(room, structureType) {
    return room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == structureType;
        }
    }).length;
}

function hasStoredEnergy(room) {
    var stores = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return structure.store &&
                structure.store[RESOURCE_ENERGY] >= 500 &&
                (structure.structureType == STRUCTURE_STORAGE ||
                structure.structureType == STRUCTURE_CONTAINER);
        }
    });

    return stores.length > 0;
}

function getHostileThreatCount(room) {
    var hostiles = room.find(FIND_HOSTILE_CREEPS, {
        filter: function(creep) {
            return creep.getActiveBodyparts(ATTACK) > 0 ||
                creep.getActiveBodyparts(RANGED_ATTACK) > 0 ||
                creep.getActiveBodyparts(WORK) > 0 ||
                creep.getActiveBodyparts(CLAIM) > 0;
        }
    });

    return hostiles.length;
}

function scaleHarvesters(room, targets) {
    var sourceCount = room.find(FIND_SOURCES).length;
    targets.harvester = Math.max(targets.harvester, sourceCount);

    if(room.energyCapacityAvailable >= 550) {
        targets.harvester = Math.max(targets.harvester, sourceCount + 1);
    }

    if(room.energyCapacityAvailable >= 800 && countStructures(room, STRUCTURE_EXTENSION) >= 5) {
        targets.harvester = Math.max(targets.harvester, sourceCount + 2);
    }

    if(room.controller && room.controller.level >= 4 && hasStoredEnergy(room)) {
        targets.harvester = Math.max(targets.harvester, sourceCount + 2);
    }
}

function scaleBuilders(room, targets, constructionSites) {
    if(constructionSites >= 5) {
        targets.builder = Math.max(targets.builder, 2);
    }

    if(constructionSites >= 15) {
        targets.builder = Math.max(targets.builder, 3);
    }

    if(constructionSites >= 30) {
        targets.builder = Math.max(targets.builder, 4);
    }

    if(room.controller && room.controller.level >= 4 && constructionSites >= 10) {
        targets.builder = Math.max(targets.builder, 3);
    }
}

function scaleUpgraders(room, counts, targets, constructionSites) {
    var energyStable = room.energyCapacityAvailable >= 550 &&
        room.energyAvailable == room.energyCapacityAvailable &&
        constructionSites < 5 &&
        counts.harvester >= targets.harvester;

    if(energyStable) {
        targets.upgrader = Math.max(targets.upgrader, 2);
    }

    if(energyStable && room.energyCapacityAvailable >= 800 && hasStoredEnergy(room)) {
        targets.upgrader = Math.max(targets.upgrader, 3);
    }

    if(energyStable &&
        room.controller &&
        room.controller.level >= 4 &&
        room.energyCapacityAvailable >= 1300 &&
        hasStoredEnergy(room)) {
        targets.upgrader = Math.max(targets.upgrader, 4);
    }
}

function scaleDefenders(room, targets) {
    var threatCount = getHostileThreatCount(room);
    if(threatCount > 0 || room.memory.defenseMode) {
        targets.defender = Math.max(targets.defender, 2);
    }

    if(threatCount >= 2) {
        targets.defender = Math.max(targets.defender, 3);
    }

    if(room.controller && room.controller.level >= 4 && countStructures(room, STRUCTURE_TOWER) > 0) {
        targets.defender = Math.max(targets.defender, 2);
    }
}

function getTargets(room, counts) {
    var targets = getMinimumTargets(room);
    var constructionSites = room.find(FIND_CONSTRUCTION_SITES).length;

    scaleHarvesters(room, targets);
    scaleBuilders(room, targets, constructionSites);
    scaleUpgraders(room, counts, targets, constructionSites);
    scaleDefenders(room, targets);

    return targets;
}

function getSpawnRole(counts, targets) {
    if(counts.harvester === 0) {
        return 'harvester';
    }

    for(var i = 0; i < ROLE_PRIORITY.length; i++) {
        var role = ROLE_PRIORITY[i];
        if(counts[role] < targets[role]) {
            return role;
        }
    }

    return null;
}

function formatTargets(targets) {
    return 'H ' + targets.harvester +
        ' B ' + targets.builder +
        ' U ' + targets.upgrader +
        ' D ' + targets.defender;
}

function logTargetChanges(room, targets) {
    var targetString = formatTargets(targets);
    if(room.memory.lastSpawnTargets == targetString) {
        return;
    }

    room.memory.lastSpawnTargets = targetString;
    debug.log('debugSpawn', room.name + ' spawn targets now ' + targetString, 1);
}

function makeCreepName(role) {
    return role + '_' + Game.time;
}

function spawnRole(spawn, role, counts, targets) {
    var body = chooseBody(spawn.room, role);
    if(!body) {
        debug.log('debugSpawn', spawn.name + ' waiting for energy to spawn ' + role, 5);
        return;
    }

    var name = makeCreepName(role);
    var result = spawn.spawnCreep(body, name, {
        memory: {
            role: role,
            working: false
        }
    });

    if(result == OK) {
        debug.log(
            'debugSpawn',
            spawn.name + ' spawning ' + name + ' (' + body.join(',') + ') ' +
                'counts H ' + counts.harvester + '/' + targets.harvester +
                ' B ' + counts.builder + '/' + targets.builder +
                ' U ' + counts.upgrader + '/' + targets.upgrader +
                ' D ' + counts.defender + '/' + targets.defender,
            1
        );
        return;
    }

    debug.log('debugSpawn', spawn.name + ' failed to spawn ' + role + ': ' + result, 5);
}

var spawnManager = {
    run: function(spawn) {
        if(spawn.spawning) {
            return;
        }

        var counts = countRoles(spawn.room);
        var targets = getTargets(spawn.room, counts);
        logTargetChanges(spawn.room, targets);
        var role = getSpawnRole(counts, targets);

        if(!role) {
            debug.log('debugSpawn', spawn.name + ' has all creep targets satisfied', 20);
            return;
        }

        spawnRole(spawn, role, counts, targets);
    },

    countRoles: countRoles,
    getTargets: getTargets
};

module.exports = spawnManager;
