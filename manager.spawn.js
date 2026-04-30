var debug = require('utils.debug');

var BASE_TARGETS = {
    harvester: 2,
    transporter: 0,
    upgrader: 1,
    builder: 1,
    mineralHarvester: 0,
    defender: 0
};

var ROLE_PRIORITY = ['harvester', 'transporter', 'upgrader', 'builder', 'defender', 'mineralHarvester'];

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
        [CARRY, CARRY, CARRY, MOVE, MOVE, MOVE],
        [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE]
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
    mineralHarvester: [
        [WORK, CARRY, MOVE],
        [WORK, WORK, CARRY, MOVE, MOVE],
        [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE],
        [WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE]
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
    mineralHarvester: [WORK, WORK, CARRY, MOVE],
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

function chooseBodyForEnergy(role, bodyType, energyAvailable) {
    var selectedType = bodyType || role;
    var options = BODIES[selectedType] || BODIES[role] || BODIES.harvester;
    var configuredBody = getBestConfiguredBody(options, energyAvailable);
    if(!configuredBody) {
        return null;
    }

    var topConfiguredBody = options[options.length - 1];
    if(bodyCost(topConfiguredBody) > energyAvailable) {
        return sortBody(cloneBody(configuredBody));
    }

    return growBody(configuredBody, BODY_GROWTH[selectedType] || BODY_GROWTH[role], energyAvailable);
}

function chooseBody(room, role, bodyType, energyBudget) {
    var budget = energyBudget === undefined ? room.energyAvailable : energyBudget;
    return chooseBodyForEnergy(role, bodyType, budget);
}

function shouldUseRecoveryBody(room, role, counts, targets) {
    if(role == 'harvester' && counts.harvester === 0) {
        return true;
    }

    if(role == 'transporter' &&
        counts.transporter === 0 &&
        targets.transporter > 0 &&
        countSourceContainers(room) > 0) {
        return true;
    }

    if(role == 'defender' &&
        counts.defender === 0 &&
        (room.memory.defenseMode || getHostileThreatCount(room) > 0)) {
        return true;
    }

    return false;
}

function getSpawnBodyDecision(room, role, bodyType, counts, targets) {
    var recoverySpawn = shouldUseRecoveryBody(room, role, counts, targets);
    var desiredBody = chooseBody(room, role, bodyType, room.energyCapacityAvailable);
    var desiredCost = desiredBody ? bodyCost(desiredBody) : 0;

    if(recoverySpawn) {
        var recoveryBody = chooseBody(room, role, bodyType, room.energyAvailable);
        return {
            body: recoveryBody,
            desiredCost: desiredCost,
            recoverySpawn: true
        };
    }

    if(!desiredBody) {
        return {
            body: null,
            desiredCost: desiredCost,
            recoverySpawn: false
        };
    }

    if(room.energyAvailable < desiredCost) {
        return {
            body: null,
            desiredCost: desiredCost,
            recoverySpawn: false
        };
    }

    return {
        body: desiredBody,
        desiredCost: desiredCost,
        recoverySpawn: false
    };
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
        mineralHarvester: 0,
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
        mineralHarvester: memoryTargets.mineralHarvester === undefined ? BASE_TARGETS.mineralHarvester : memoryTargets.mineralHarvester,
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

function hasMineralStorage(room) {
    var structures = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return (structure.structureType == STRUCTURE_TERMINAL ||
                structure.structureType == STRUCTURE_STORAGE) &&
                structure.store.getFreeCapacity() > 0;
        }
    });

    return structures.length > 0;
}

function hasExtractor(room) {
    return countStructures(room, STRUCTURE_EXTRACTOR) > 0;
}

function hasAvailableMineral(room) {
    var minerals = room.find(FIND_MINERALS, {
        filter: function(mineral) {
            return mineral.mineralAmount > 0;
        }
    });

    return minerals.length > 0;
}

function countDefenseRepairTargets(room) {
    var targetHits = room.memory.wallTargetHits || 1000;
    var structures = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return (structure.structureType == STRUCTURE_WALL ||
                structure.structureType == STRUCTURE_RAMPART) &&
                structure.hits < targetHits;
        }
    });

    return structures.length;
}

function countCriticalDefenseRepairTargets(room) {
    var targetHits = Math.min(room.memory.wallTargetHits || 1000, room.memory.criticalWallHits || 1000);
    var structures = room.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return (structure.structureType == STRUCTURE_WALL ||
                structure.structureType == STRUCTURE_RAMPART) &&
                structure.hits < targetHits;
        }
    });

    return structures.length;
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

    if(hasStorage && room.energyCapacityAvailable >= 800) {
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
    var defenseRepairTargets = countDefenseRepairTargets(room);
    var criticalDefenseRepairTargets = countCriticalDefenseRepairTargets(room);

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

    if(constructionSites === 0 && defenseRepairTargets > 0 && room.energyCapacityAvailable >= 550) {
        targets.builder = Math.max(targets.builder, 2);
    }

    if(constructionSites === 0 &&
        criticalDefenseRepairTargets >= 10 &&
        hasStoredEnergy(room) &&
        room.energyCapacityAvailable >= 800) {
        targets.builder = Math.max(targets.builder, 3);
    }
}

function scaleUpgraders(room, counts, targets, constructionSites) {
    var defenseRepairBacklog = room.memory.defenseMode ||
        getHostileThreatCount(room) > 0 ||
        countCriticalDefenseRepairTargets(room) > 0;
    var energyStable = room.energyCapacityAvailable >= 550 &&
        room.energyAvailable == room.energyCapacityAvailable &&
        constructionSites < 5 &&
        counts.harvester >= targets.harvester &&
        !defenseRepairBacklog;

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

function scaleMineralHarvesters(room, targets) {
    if(!room.controller ||
        room.controller.level < 6 ||
        !hasExtractor(room) ||
        !hasMineralStorage(room) ||
        !hasAvailableMineral(room)) {
        targets.mineralHarvester = 0;
        return;
    }

    targets.mineralHarvester = Math.max(targets.mineralHarvester, 1);
}

function scaleDefenders(room, targets) {
    var threatCount = getHostileThreatCount(room);
    var canUseDefenderSquad = room.energyCapacityAvailable >= bodyCost(MIN_DEFENDER_HEALER_BODY);
    var wantsStandingSquad = room.memory.keepDefenderSquad === true;
    var needsDefense = threatCount > 0 || room.memory.defenseMode || wantsStandingSquad;

    if(!needsDefense) {
        targets.defender = 0;
        room.memory.defenderSquadEnabled = false;
        return;
    }

    if(!canUseDefenderSquad && room.energyCapacityAvailable >= bodyCost(BODIES.defender[0])) {
        targets.defender = Math.max(targets.defender, 1);
    }

    if(canUseDefenderSquad) {
        targets.defender = Math.max(targets.defender, 2);
    }

    if(canUseDefenderSquad && threatCount >= 2) {
        targets.defender = Math.max(targets.defender, 3);
    }

    if(canUseDefenderSquad && wantsStandingSquad) {
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
    scaleMineralHarvesters(room, targets);
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
        ' M ' + targets.mineralHarvester +
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
    var bodyType = getBodyType(role, defenderType);
    var bodyDecision = getSpawnBodyDecision(spawn.room, role, bodyType, counts, targets);
    var body = bodyDecision.body;
    if(!body) {
        var desiredCost = bodyDecision.desiredCost || spawn.room.energyCapacityAvailable;
        debug.log(
            'debugSpawn',
            spawn.name + ' waiting for energy to spawn ' +
                (defenderType ? defenderType + ' ' : '') + role +
                ' (' + spawn.room.energyAvailable + '/' + desiredCost + ')',
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
                'energy ' + bodyCost(body) + '/' + spawn.room.energyCapacityAvailable +
                (bodyDecision.recoverySpawn ? ' recovery ' : ' ') +
                'counts H ' + counts.harvester + '/' + targets.harvester +
                ' T ' + counts.transporter + '/' + targets.transporter +
                ' B ' + counts.builder + '/' + targets.builder +
                ' U ' + counts.upgrader + '/' + targets.upgrader +
                ' M ' + counts.mineralHarvester + '/' + targets.mineralHarvester +
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
