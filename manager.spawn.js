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
        [WORK, WORK, CARRY, MOVE]
    ],
    upgrader: [
        [WORK, CARRY, MOVE],
        [WORK, CARRY, CARRY, MOVE, MOVE]
    ],
    builder: [
        [WORK, CARRY, MOVE],
        [WORK, CARRY, CARRY, MOVE, MOVE]
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

function getTargets(room, counts) {
    var memoryTargets = room.memory.creepTargets || BASE_TARGETS;
    var targets = {
        harvester: memoryTargets.harvester === undefined ? BASE_TARGETS.harvester : memoryTargets.harvester,
        upgrader: memoryTargets.upgrader === undefined ? BASE_TARGETS.upgrader : memoryTargets.upgrader,
        builder: memoryTargets.builder === undefined ? BASE_TARGETS.builder : memoryTargets.builder,
        defender: memoryTargets.defender === undefined ? BASE_TARGETS.defender : memoryTargets.defender
    };

    var constructionSites = room.find(FIND_CONSTRUCTION_SITES).length;
    if(constructionSites >= 5) {
        targets.builder = Math.max(targets.builder, 2);
    }

    if(constructionSites >= 15) {
        targets.builder = Math.max(targets.builder, 3);
    }

    var energyStable = room.energyCapacityAvailable >= 550 &&
        room.energyAvailable == room.energyCapacityAvailable &&
        constructionSites < 5 &&
        counts.harvester >= targets.harvester;

    if(energyStable) {
        targets.upgrader = Math.max(targets.upgrader, 2);
    }

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
