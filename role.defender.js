var creepUtils = require('utils.creep');
var debug = require('utils.debug');

function assignDefenderType(creep) {
    if(creep.memory.defenderType == 'healer' || creep.memory.defenderType == 'attacker') {
        return creep.memory.defenderType;
    }

    creep.memory.defenderType = creep.getActiveBodyparts(HEAL) > 0 ? 'healer' : 'attacker';
    return creep.memory.defenderType;
}

function findHostile(creep) {
    return creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS, {
        filter: function(hostile) {
            return creepUtils.canReachBeforeDecay(creep, hostile, 1);
        }
    });
}

function getGuardTarget(creep) {
    var spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    if(spawn) {
        return spawn;
    }

    return creep.room.controller || creep;
}

function isSquadEnabled(creep) {
    return creep.room.memory.defenderSquadEnabled === true;
}

function isActiveDefender(creep) {
    return creep.memory.role == 'defender' && !creep.spawning;
}

function hasAttackParts(creep) {
    return creep.getActiveBodyparts(ATTACK) > 0 ||
        creep.getActiveBodyparts(RANGED_ATTACK) > 0;
}

function hasHealParts(creep) {
    return creep.getActiveBodyparts(HEAL) > 0;
}

function findClosestDefender(creep, predicate) {
    var defenders = creep.room.find(FIND_MY_CREEPS, {
        filter: function(other) {
            return other.name != creep.name &&
                isActiveDefender(other) &&
                predicate(other);
        }
    });

    defenders.sort(function(a, b) {
        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
    });

    return defenders[0] || null;
}

function findSquadHealer(creep) {
    return findClosestDefender(creep, function(other) {
        return other.memory.defenderType == 'healer' || hasHealParts(other);
    });
}

function findSquadAttacker(creep) {
    return findClosestDefender(creep, function(other) {
        return (other.memory.defenderType == 'attacker' || hasAttackParts(other)) &&
            hasAttackParts(other);
    });
}

function findDamagedDefender(creep) {
    var damaged = creep.room.find(FIND_MY_CREEPS, {
        filter: function(other) {
            return isActiveDefender(other) && other.hits < other.hitsMax;
        }
    });

    damaged.sort(function(a, b) {
        var damageDiff = (a.hits / a.hitsMax) - (b.hits / b.hitsMax);
        if(damageDiff !== 0) {
            return damageDiff;
        }

        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
    });

    return damaged[0] || null;
}

function healSquad(creep) {
    if(!hasHealParts(creep)) {
        return false;
    }

    var target = creep.hits < creep.hitsMax ? creep : findDamagedDefender(creep);
    if(!target) {
        return false;
    }

    if(creep.pos.inRangeTo(target, 1)) {
        if(creep.heal(target) == OK) {
            creepUtils.announceIntent(creep, 'action:heal', target.name == creep.name ? 'heal self' : 'heal');
            return true;
        }
    }

    if(creep.pos.inRangeTo(target, 3) && creep.rangedHeal(target) == OK) {
        creepUtils.announceIntent(creep, 'action:rangedHeal', 'heal');
        return true;
    }

    return false;
}

function attackHostile(creep, hostile) {
    if(!creepUtils.canReachBeforeDecay(creep, hostile, 1)) {
        debug.log('debugDefense', creep.name + ' skipped hostile that will decay before arrival', 5);
        return false;
    }

    var result = creep.attack(hostile);
    if(result == ERR_NOT_IN_RANGE) {
        debug.log('debugDefense', creep.name + ' moving to defend against hostile in ' + creep.room.name, 3);
        creepUtils.moveTo(creep, hostile, '#ff3333', 'defend', 'move:defend');
        return true;
    }

    if(result == OK) {
        creepUtils.announceIntent(creep, 'action:attack', 'attack');
        debug.log('debugDefense', creep.name + ' attacking hostile in ' + creep.room.name, 3);
        return true;
    }

    debug.log('debugDefense', creep.name + ' attack failed: ' + result, 5);
    return false;
}

function moveToSquadMate(creep, squadMate, label) {
    if(!squadMate) {
        return false;
    }

    if(creep.pos.getRangeTo(squadMate) > 1) {
        creepUtils.moveTo(creep, squadMate, '#ffcc00', label || 'group', 'move:defenderGroup');
        return true;
    }

    creepUtils.announceIntent(creep, 'action:group', label || 'group');
    return true;
}

function hasRoadOrRoadSite(pos) {
    var structures = pos.lookFor(LOOK_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        if(structures[i].structureType == STRUCTURE_ROAD) {
            return true;
        }
    }

    var sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    for(var j = 0; j < sites.length; j++) {
        if(sites[j].structureType == STRUCTURE_ROAD) {
            return true;
        }
    }

    return false;
}

function isWalkableIdlePosition(creep, pos) {
    if(pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49) {
        return false;
    }

    if(creep.room.getTerrain().get(pos.x, pos.y) == TERRAIN_MASK_WALL) {
        return false;
    }

    if(hasRoadOrRoadSite(pos)) {
        return false;
    }

    var creeps = pos.lookFor(LOOK_CREEPS);
    for(var i = 0; i < creeps.length; i++) {
        if(creeps[i].name != creep.name) {
            return false;
        }
    }

    var structures = pos.lookFor(LOOK_STRUCTURES);
    for(var j = 0; j < structures.length; j++) {
        if(structures[j].structureType != STRUCTURE_RAMPART) {
            return false;
        }
    }

    return true;
}

function findRoadIdleFallback(creep, guardTarget) {
    var targetPos = guardTarget.pos || guardTarget;
    var candidates = [];

    for(var range = 1; range <= 3; range++) {
        for(var dx = -range; dx <= range; dx++) {
            for(var dy = -range; dy <= range; dy++) {
                if(Math.max(Math.abs(dx), Math.abs(dy)) != range) {
                    continue;
                }

                var pos = new RoomPosition(creep.pos.x + dx, creep.pos.y + dy, creep.pos.roomName);
                if(isWalkableIdlePosition(creep, pos)) {
                    candidates.push(pos);
                }
            }
        }

        if(candidates.length) {
            break;
        }
    }

    if(!candidates.length) {
        return null;
    }

    candidates.sort(function(a, b) {
        var targetDiff = a.getRangeTo(targetPos) - b.getRangeTo(targetPos);
        if(targetDiff !== 0) {
            return targetDiff;
        }

        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
    });

    return candidates[0];
}

function stepOffRoadIfIdle(creep, guardTarget) {
    if(!hasRoadOrRoadSite(creep.pos)) {
        return false;
    }

    var fallback = findRoadIdleFallback(creep, guardTarget);
    if(!fallback) {
        return false;
    }

    debug.log(
        'debugDefense',
        creep.name + ' stepping off road while idle',
        5
    );

    if(creep.pos.getRangeTo(fallback) <= 1) {
        creepUtils.announceIntent(creep, 'action:guardStep', 'clear road');
        creep.move(creep.pos.getDirectionTo(fallback));
        return true;
    }

    creepUtils.moveTo(creep, fallback, '#ffcc00', 'clear road', 'move:defenderIdle');
    return true;
}

function guardBase(creep) {
    var target = getGuardTarget(creep);
    if(!creepUtils.canReachBeforeDecay(creep, target, 3)) {
        debug.log('debugDefense', creep.name + ' cannot reach guard target before decay', 5);
        return;
    }

    if(creep.pos.getRangeTo(target) > 3) {
        creepUtils.moveTo(creep, target, '#ffcc00', 'guard', 'move:guard');
        return;
    }

    if(stepOffRoadIfIdle(creep, target)) {
        return;
    }

    creepUtils.announceIntent(creep, 'action:guard', 'guard');
}

function runHealer(creep) {
    healSquad(creep);

    var hostile = findHostile(creep);
    var attacker = findSquadAttacker(creep);
    if(!hostile) {
        if(attacker && creep.pos.getRangeTo(attacker) > 2) {
            moveToSquadMate(creep, attacker, 'group');
            return;
        }

        guardBase(creep);
        return;
    }

    if(!attacker) {
        debug.log('debugDefense', creep.name + ' waiting for attacker before engaging', 5);
        guardBase(creep);
        return;
    }

    if(creep.pos.getRangeTo(attacker) > 3 && creep.pos.getRangeTo(hostile) > 3) {
        moveToSquadMate(creep, attacker, 'group');
        return;
    }

    if(creep.pos.getRangeTo(hostile) > 1) {
        debug.log('debugDefense', creep.name + ' moving to tank hostile in ' + creep.room.name, 3);
        creepUtils.moveTo(creep, hostile, '#ff66cc', 'tank', 'move:tank');
        return;
    }

    creepUtils.announceIntent(creep, 'action:tank', 'tank');
}

function runAttacker(creep) {
    var hostile = findHostile(creep);
    if(!hostile) {
        guardBase(creep);
        return;
    }

    if(!isSquadEnabled(creep)) {
        attackHostile(creep, hostile);
        return;
    }

    var healer = findSquadHealer(creep);
    if(!healer) {
        debug.log('debugDefense', creep.name + ' waiting for healer before attacking', 5);
        guardBase(creep);
        return;
    }

    if(creep.pos.getRangeTo(healer) > 3) {
        moveToSquadMate(creep, healer, 'group');
        return;
    }

    if(healer.pos.getRangeTo(hostile) > 1) {
        moveToSquadMate(creep, healer, 'behind');
        return;
    }

    attackHostile(creep, hostile);
}

var roleDefender = {
    run: function(creep) {
        if(assignDefenderType(creep) == 'healer') {
            runHealer(creep);
            return;
        }

        runAttacker(creep);
    }
};

module.exports = roleDefender;
