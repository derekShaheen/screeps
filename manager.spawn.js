var debug = require('utils.debug');

var BASE_TARGETS = {
    harvester: 2,
    transporter: 0,
    upgrader: 1,
    builder: 1,
    defender: 1
};

var ROLE_PRIORITY = ['harvester', 'transporter', 'upgrader', 'builder', 'defender'];

var BODIES = {
    harvester: [
        [WORK, CARRY, MOVE],
        [WORK, WORK, CARRY, MOVE],
        [WORK, WORK, WORK, CARRY, MOVE, MOVE],
        [WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE]
    ],
    transporter: [
        [CARRY, CARRY, MOVE],
        [CARRY, CARRY, CARRY, MOVE, MOVE],
        [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE],
        [CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE]
    ],
    upgrader: [
        [WORK, CARRY, MOVE],
        [WORK, WORK, CARRY, MOVE],
        [WORK, WORK, CARRY, CARRY, MOVE, MOVE],
        [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE]
    ],
    builder: [
        [WORK, CARRY, MOVE],
        [WORK, CARRY, CARRY, MOVE],
        [WORK, WORK, CARRY, CARRY, MOVE, MOVE],
        [WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE]
    ],
    defender: [
        [ATTACK, ATTACK, MOVE],
        [TOUGH, ATTACK, MOVE, MOVE],
        [TOUGH, ATTACK, ATTACK, MOVE, MOVE],
        [TOUGH, ATTACK, ATTACK, ATTACK, MOVE, MOVE],
        [TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, MOVE, MOVE]
    ],
    defenderHealer: [
        [TOUGH, HEAL, MOVE],
        [TOUGH, TOUGH, HEAL, MOVE, MOVE],
        [TOUGH, TOUGH, HEAL, HEAL, MOVE, MOVE],
        [TOUGH, TOUGH, TOUGH, HEAL, HEAL, MOVE, MOVE, MOVE],
        [TOUGH, TOUGH, TOUGH, TOUGH, HEAL, HEAL, HEAL, MOVE, MOVE, MOVE]
    ]
};

var MIN_DEFENDER_HEALER_BODY = [TOUGH, HEAL, MOVE];
var MAX_CREEP_PARTS = 50;

var BODY_GROWTH = {
    harvester: [WORK, CARRY, MOVE],
    transporter: [CARRY, CARRY, MOVE],
    upgrader: [WORK, WORK, CARRY, MOVE],
    builder: [WORK, CARRY, CARRY, MOVE],
    defender: [TOUGH, ATTACK, MOVE],
    defenderHealer: [TOUGH, HEAL, MOVE]
};

var BODY_ORDER = {};
BODY_ORDER[TOUGH] = 1;
BODY_ORDER[WORK] = 2;
BODY_ORDER[CARRY] = 3;
BODY_ORDER[ATTACK] = 4;
BODY_ORDER[RANGED_ATTACK] = 5;
BODY_ORDER[HEAL] = 6;
BODY_ORDER[CLAIM] = 7;
BODY_ORDER[MOVE] = 8;

function bodyCost(body) {
    var cost = 0;
    for(var i = 0; i < body.length; i++) {
        cost += BODYPART_COST[body[i]];
    }

    return cost;
}

function sortBody(body) {
    body.sort(function(a, b) {
        return (BODY_ORDER[a] || 99) - (BODY_ORDER[b] || 99);
    });

    return body;
}

function cloneBody(body) {
    var copy = [];
    for(var i = 0; i < body.length; i++) {
        copy.push(body[i]);
    }

    return copy;
}

function getBestConfiguredBody(options, energyAvailable) {
    for(var i = options.length - 1; i >= 0; i--) {
        if(bodyCost(options[i]) <= energyAvailable) {
            return options[i];
        }
    }

    return null;
}

function growBody(baseBody, growthParts, energyAvailable) {
    var body = cloneBody(baseBody);
    var currentCost = bodyCost(body);
    var growthCost = bodyCost(growthParts);

    if(!growthParts || !growthParts.length || growthCost <= 0) {
        return sortBody(body);
    }

    while(body.length + growthParts.length <= MAX_CREEP_PARTS &&
        currentCost + growthCost <= energyAvailable) {
        for(var i = 0; i < growthParts.length; i++) {
            body.push(growthParts[i]);
        }
        currentCost += growthCost;
    }

    return sortBody(body);
}

function chooseBody(room, role, bodyType) {
    var selectedType = bodyType || role;
    var options = BODIES[selectedType] || BODIES[role] || BODIES.harvester;
    var configuredBody = getBestConfiguredBody(options, room.energyAvailable);
    if(!configuredBody) {
        return null;
    }

    var topConfiguredBody = options[options.length - 1];
    if(bodyCost(topConfiguredBody) > room.energyAvailable) {
        return configuredBody;
    }

    return growBody(configuredBody, BODY_GROWTH[selectedType] || BODY_GROWTH[role], room.energyAvailable);
}

function getDefenderType(creep) {
    if(creep.memory.defenderType == 'healer' || creep.memory.defenderType == 'attacker') {
        return creep.memory.defenderType;
    }

    if(creep.getActiveBodyparts && creep.getActiveBodyparts(HEAL) > 0) {
        return 'healer';
    }

    return 'attacker';
}

function countRoles(room) {
    var counts = {
        harvester: 0,
        transporter: 0,
        upgrader: 0,
        builder: 0,
        defender: 0,
        defenderAttackers: 0,
        defenderHealers: 0
    };

    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.room.name != room.name) {
            continue;
        }

        if(counts[creep.memory.role] !== undefined) {
            counts[creep.memory.role]++;
            if(creep.memory.role == 'defender') {
                if(getDefenderType(creep) == 'healer') {
                    counts.defenderHealers++;
                }
                else {
                    counts.defenderAttackers++;
                }
            }
        }
    }

    return counts;
}

function getMinimumTargets(room) {
    var memoryTargets = room.memory.creepTargets || BASE_TARGETS;
    return {
        harvester: memoryTargets.harvester === undefined ? BASE_TARGETS.harvester : memoryTargets.harvester,
        transporter: memoryTargets.transporter === undefined ? BASE_TARGETS.transporter : memoryTargets.transporter,
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

function countSourceContainers(room) {
    var containers = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_CONTAINER &&
                structure.pos.findInRange(FIND_SOURCES, 1).length > 0;
        }
    });

    return containers.length;
}

function countSourceContainerSites(room) {
    var sites = room.find(FIND_CONSTRUCTION_SITES, {
        filter: function(site) {
            return site.structureType == STRUCTURE_CONTAINER &&
                site.pos.findInRange(FIND_SOURCES, 1).length > 0;
        }
    });

    return sites.length;
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
    var sourceContainers = countSourceContainers(room);
    var plannedSourceContainers = sourceContainers + countSourceContainerSites(room);
    var uncoveredSources = Math.max(0, sourceCount - plannedSourceContainers);
    var desiredHarvesters = sourceCount + uncoveredSources;

    if(sourceContainers >= sourceCount) {
        desiredHarvesters = sourceCount;
    }
    else if(sourceContainers > 0 || plannedSourceContainers >= sourceCount) {
        desiredHarvesters = sourceCount + Math.min(uncoveredSources, 1);
    }
    else if(room.energyCapacityAvailable >= 550) {
        desiredHarvesters = sourceCount + 1;
    }

    if(sourceContainers === 0 &&
        room.energyCapacityAvailable >= 800 &&
        countStructures(room, STRUCTURE_EXTENSION) >= 5) {
        desiredHarvesters = sourceCount + 2;
    }

    if(sourceContainers === 0 &&
        room.controller &&
        room.controller.level >= 4 &&
        hasStoredEnergy(room)) {
        desiredHarvesters = sourceCount + 2;
    }

    targets.harvester = Math.max(targets.harvester, desiredHarvesters);
}

function scaleTransporters(room, targets) {
    var sourceContainers = countSourceContainers(room);
    var hasStorage = countStructures(room, STRUCTURE_STORAGE) > 0;

    if(sourceContainers > 0 || hasStorage) {
        targets.transporter = Math.max(targets.transporter, 1);
    }

    if(sourceContainers > 0 && room.energyCapacityAvailable >= 550) {
        targets.transporter = Math.max(targets.transporter, 2);
    }

    if(sourceContainers >= 2 && room.energyCapacityAvailable >= 800) {
        targets.transporter = Math.max(targets.transporter, 3);
    }

    if(room.memory.defenseMode && countStructures(room, STRUCTURE_TOWER) > 0) {
        targets.transporter = Math.max(targets.transporter, 2);
    }

    if(room.controller &&
        room.controller.level >= 4 &&
        hasStoredEnergy(room) &&
        room.energyCapacityAvailable >= 800) {
        targets.transporter = Math.max(targets.transporter, 3);
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
    var canUseDefenderSquad = room.energyCapacityAvailable >= bodyCost(MIN_DEFENDER_HEALER_BODY);

    if(canUseDefenderSquad && (threatCount > 0 || room.memory.defenseMode)) {
        targets.defender = Math.max(targets.defender, 2);
    }

    if(canUseDefenderSquad && threatCount >= 2) {
        targets.defender = Math.max(targets.defender, 3);
    }

    if(canUseDefenderSquad && room.memory.keepDefenderSquad) {
        targets.defender = Math.max(targets.defender, 2);
    }

    room.memory.defenderSquadEnabled = canUseDefenderSquad && targets.defender >= 2;
}

function getTargets(room, counts) {
    var targets = getMinimumTargets(room);
    var constructionSites = room.find(FIND_CONSTRUCTION_SITES).length;

    scaleHarvesters(room, targets);
    scaleTransporters(room, targets);
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
        ' T ' + targets.transporter +
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

function getDefenderSpawnType(room, counts, targets) {
    if(targets.defender < 2 ||
        room.energyCapacityAvailable < bodyCost(MIN_DEFENDER_HEALER_BODY)) {
        return 'attacker';
    }

    if(counts.defenderHealers < 1) {
        return 'healer';
    }

    return 'attacker';
}

function getBodyType(role, defenderType) {
    if(role == 'defender' && defenderType == 'healer') {
        return 'defenderHealer';
    }

    return role;
}

function spawnRole(spawn, role, counts, targets) {
    var defenderType = role == 'defender' ? getDefenderSpawnType(spawn.room, counts, targets) : null;
    var body = chooseBody(spawn.room, role, getBodyType(role, defenderType));
    if(!body) {
        debug.log(
            'debugSpawn',
            spawn.name + ' waiting for energy to spawn ' +
                (defenderType ? defenderType + ' ' : '') + role,
            5
        );
        return;
    }

    var name = makeCreepName(role);
    var memory = {
        role: role,
        working: false
    };
    if(defenderType) {
        memory.defenderType = defenderType;
    }

    var result = spawn.spawnCreep(body, name, {
        memory: memory
    });

    if(result == OK) {
        debug.log(
            'debugSpawn',
            spawn.name + ' spawning ' + name +
                (defenderType ? ' ' + defenderType : '') +
                ' (' + body.join(',') + ') ' +
                'counts H ' + counts.harvester + '/' + targets.harvester +
                ' T ' + counts.transporter + '/' + targets.transporter +
                ' B ' + counts.builder + '/' + targets.builder +
                ' U ' + counts.upgrader + '/' + targets.upgrader +
                ' D ' + counts.defender + '/' + targets.defender +
                ' A ' + counts.defenderAttackers +
                ' He ' + counts.defenderHealers,
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
