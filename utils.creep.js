var debug = require('utils.debug');

function announceIntent(creep, key, message) {
    if(!key || !message) {
        return;
    }

    if(creep.memory.intentKey == key) {
        return;
    }

    creep.memory.intentKey = key;
    creep.memory.intentTick = Game.time;
    creep.say(message);
}

function moveTo(creep, target, stroke, intentMessage, intentKey) {
    announceIntent(creep, intentKey || ('move:' + intentMessage), intentMessage);

    var options = {
        reusePath: 5
    };

    if(debug.enabled('debugVisuals') && debug.enabled('debugPaths')) {
        options.visualizePathStyle = {
            stroke: stroke || '#ffffff',
            opacity: 0.55,
            strokeWidth: 0.12,
            lineStyle: 'dashed'
        };
    }

    return creep.moveTo(target, options);
}

function hasThreatParts(creep) {
    return creep.getActiveBodyparts(ATTACK) > 0 ||
        creep.getActiveBodyparts(RANGED_ATTACK) > 0 ||
        creep.getActiveBodyparts(WORK) > 0 ||
        creep.getActiveBodyparts(CLAIM) > 0;
}

function isCombatCreep(creep) {
    return creep.getActiveBodyparts(ATTACK) > 0 ||
        creep.getActiveBodyparts(RANGED_ATTACK) > 0 ||
        creep.getActiveBodyparts(HEAL) > 0;
}

function isSafeTarget(creep, target, range) {
    if(isCombatCreep(creep)) {
        return true;
    }

    if(!target || !target.pos) {
        return true;
    }

    var dangerRange = range || 5;
    var threats = target.pos.findInRange(FIND_HOSTILE_CREEPS, dangerRange, {
        filter: function(hostile) {
            return hasThreatParts(hostile);
        }
    });

    return threats.length === 0;
}

function findNearbyThreats(creep, range) {
    return creep.pos.findInRange(FIND_HOSTILE_CREEPS, range, {
        filter: function(hostile) {
            return hasThreatParts(hostile);
        }
    });
}

function getFallbackRetreatTarget(creep) {
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

function retreatFromHostiles(creep, range) {
    var fleeRange = range || 5;
    var threats = findNearbyThreats(creep, fleeRange);
    if(!threats.length) {
        return false;
    }

    releaseEnergyQueue(creep);
    announceIntent(creep, 'action:retreat', 'retreat');

    if(typeof PathFinder !== 'undefined') {
        var goals = [];
        for(var i = 0; i < threats.length; i++) {
            goals.push({
                pos: threats[i].pos,
                range: fleeRange
            });
        }

        var result = PathFinder.search(creep.pos, goals, {
            flee: true,
            maxRooms: 1,
            plainCost: 2,
            swampCost: 10,
            roomCallback: function(roomName) {
                if(roomName != creep.room.name) {
                    return false;
                }

                var costs = new PathFinder.CostMatrix();
                for(var edge = 0; edge < 50; edge++) {
                    costs.set(edge, 0, 255);
                    costs.set(edge, 49, 255);
                    costs.set(0, edge, 255);
                    costs.set(49, edge, 255);
                }

                return costs;
            }
        });

        if(result.path.length) {
            debug.log('debugDefense', creep.name + ' retreating from ' + threats.length + ' threat(s)', 3);
            moveTo(creep, result.path[0], '#ff66cc', 'retreat', 'move:retreat');
            return true;
        }
    }

    debug.log('debugDefense', creep.name + ' retreat fallback toward base', 3);
    moveTo(creep, getFallbackRetreatTarget(creep), '#ff66cc', 'retreat', 'move:retreat');
    return true;
}

function setWorking(creep, working, label) {
    if(creep.memory.working !== working) {
        creep.memory.working = working;
        if(working) {
            releaseEnergyQueue(creep);
        }
        debug.roleState(creep, working ? 'working' : 'gathering');
        if(label) {
            announceIntent(creep, 'state:' + label, label);
        }
    }
}

function updateWorkingState(creep, workingLabel, gatheringLabel) {
    if(creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        setWorking(creep, false, gatheringLabel || 'energy');
    }

    if(!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        setWorking(creep, true, workingLabel || 'work');
    }

    if(creep.memory.working === undefined) {
        creep.memory.working = false;
    }

    return creep.memory.working;
}

function findNearestSource(creep) {
    return creep.pos.findClosestByPath(FIND_SOURCES, {
        filter: function(source) {
            return isSafeTarget(creep, source);
        }
    });
}

function getRoomSourceQueues(room) {
    if(!room.memory.sourceQueues) {
        room.memory.sourceQueues = {};
    }

    return room.memory.sourceQueues;
}

function getSourceQueue(room, source) {
    var queues = getRoomSourceQueues(room);
    if(!queues[source.id]) {
        queues[source.id] = {
            creeps: []
        };
    }

    if(!queues[source.id].creeps) {
        queues[source.id].creeps = [];
    }

    return queues[source.id];
}

function removeNameFromQueue(queue, creepName) {
    var next = [];
    for(var i = 0; i < queue.creeps.length; i++) {
        if(queue.creeps[i] != creepName) {
            next.push(queue.creeps[i]);
        }
    }

    queue.creeps = next;
}

function releaseEnergyQueue(creep) {
    if(!creep.memory.energySourceId || !creep.room || !creep.room.memory) {
        delete creep.memory.energySourceId;
        return;
    }

    var queues = getRoomSourceQueues(creep.room);
    for(var sourceId in queues) {
        removeNameFromQueue(queues[sourceId], creep.name);
    }

    delete creep.memory.energySourceId;
}

function pruneSourceQueue(room, source) {
    var queue = getSourceQueue(room, source);
    var next = [];

    for(var i = 0; i < queue.creeps.length; i++) {
        var queuedCreep = Game.creeps[queue.creeps[i]];
        if(!queuedCreep ||
            queuedCreep.room.name != room.name ||
            queuedCreep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 ||
            queuedCreep.memory.working) {
            continue;
        }

        next.push(queue.creeps[i]);
    }

    queue.creeps = next;
    return queue;
}

function joinSourceQueue(creep, source) {
    var queues = getRoomSourceQueues(creep.room);
    for(var sourceId in queues) {
        if(sourceId != source.id) {
            removeNameFromQueue(queues[sourceId], creep.name);
        }
    }

    var queue = pruneSourceQueue(creep.room, source);
    if(queue.creeps.indexOf(creep.name) == -1) {
        queue.creeps.push(creep.name);
        debug.log(
            'debugRoles',
            creep.name + ' joined source queue ' + source.id + ' at position ' + queue.creeps.length,
            3
        );
    }

    creep.memory.energySourceId = source.id;
    return queue;
}

function getQueueIndex(queue, creepName) {
    for(var i = 0; i < queue.creeps.length; i++) {
        if(queue.creeps[i] == creepName) {
            return i;
        }
    }

    return -1;
}

function isWalkableHarvestPosition(pos, creep, ignoreCreeps) {
    if(pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49) {
        return false;
    }

    if(creep.room.getTerrain().get(pos.x, pos.y) == TERRAIN_MASK_WALL) {
        return false;
    }

    if(!ignoreCreeps) {
        var creeps = pos.lookFor(LOOK_CREEPS);
        for(var i = 0; i < creeps.length; i++) {
            if(creeps[i].name != creep.name) {
                return false;
            }
        }
    }

    var structures = pos.lookFor(LOOK_STRUCTURES);
    for(var j = 0; j < structures.length; j++) {
        var type = structures[j].structureType;
        if(type != STRUCTURE_ROAD &&
            type != STRUCTURE_CONTAINER &&
            type != STRUCTURE_RAMPART) {
            return false;
        }
    }

    return true;
}

function getAdjacentHarvestPositions(creep, source) {
    var positions = [];
    for(var dx = -1; dx <= 1; dx++) {
        for(var dy = -1; dy <= 1; dy++) {
            if(dx === 0 && dy === 0) {
                continue;
            }

            var x = source.pos.x + dx;
            var y = source.pos.y + dy;
            if(x <= 0 || x >= 49 || y <= 0 || y >= 49) {
                continue;
            }

            var pos = new RoomPosition(x, y, source.pos.roomName);
            if(isWalkableHarvestPosition(pos, creep, true)) {
                positions.push(pos);
            }
        }
    }

    positions.sort(function(a, b) {
        if(a.x != b.x) {
            return a.x - b.x;
        }

        return a.y - b.y;
    });

    return positions;
}

function getWaitingPositions(creep, source) {
    var positions = [];
    for(var range = 2; range <= 3; range++) {
        for(var dx = -range; dx <= range; dx++) {
            for(var dy = -range; dy <= range; dy++) {
                if(Math.max(Math.abs(dx), Math.abs(dy)) != range) {
                    continue;
                }

                var x = source.pos.x + dx;
                var y = source.pos.y + dy;
                if(x <= 0 || x >= 49 || y <= 0 || y >= 49) {
                    continue;
                }

                var pos = new RoomPosition(x, y, source.pos.roomName);
                if(isWalkableHarvestPosition(pos, creep, false)) {
                    positions.push(pos);
                }
            }
        }
    }

    positions.sort(function(a, b) {
        var sourceRangeDiff = a.getRangeTo(source) - b.getRangeTo(source);
        if(sourceRangeDiff !== 0) {
            return sourceRangeDiff;
        }

        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
    });

    return positions;
}

function getQueuedSourceDestination(creep, source, queue) {
    var index = getQueueIndex(queue, creep.name);
    var harvestPositions = getAdjacentHarvestPositions(creep, source);

    if(index >= 0 && index < harvestPositions.length) {
        if(isWalkableHarvestPosition(harvestPositions[index], creep, false)) {
            return harvestPositions[index];
        }
    }

    var waitingPositions = getWaitingPositions(creep, source);
    if(waitingPositions.length) {
        var waitingIndex = Math.max(index - harvestPositions.length, 0);
        return waitingPositions[waitingIndex % waitingPositions.length];
    }

    return source.pos;
}

function sourceQueueScore(creep, source) {
    if(!isSafeTarget(creep, source)) {
        return 9999 + creep.pos.getRangeTo(source);
    }

    var queue = pruneSourceQueue(creep.room, source);
    var harvestPositions = getAdjacentHarvestPositions(creep, source);
    var slots = Math.max(harvestPositions.length, 1);
    var queuePressure = queue.creeps.length / slots;
    var energyBonus = source.energy > 0 ? -2 : 0;

    return queuePressure * 10 + creep.pos.getRangeTo(source) + energyBonus;
}

function findQueuedSource(creep) {
    if(creep.memory.energySourceId) {
        var existingSource = Game.getObjectById(creep.memory.energySourceId);
        if(existingSource &&
            existingSource.room.name == creep.room.name &&
            isSafeTarget(creep, existingSource)) {
            return existingSource;
        }

        releaseEnergyQueue(creep);
    }

    var sources = creep.room.find(FIND_SOURCES, {
        filter: function(source) {
            return isSafeTarget(creep, source);
        }
    });
    if(!sources.length) {
        return null;
    }

    sources.sort(function(a, b) {
        return sourceQueueScore(creep, a) - sourceQueueScore(creep, b);
    });

    return sources[0];
}

function withdrawFromTarget(creep, target, moveIntent, actionIntent) {
    releaseEnergyQueue(creep);
    var result = creep.withdraw(target, RESOURCE_ENERGY);
    if(result == ERR_NOT_IN_RANGE) {
        moveTo(
            creep,
            target,
            '#ffaa00',
            moveIntent || 'go energy',
            'move:' + (moveIntent || 'energy')
        );
        return true;
    }

    if(result == OK) {
        announceIntent(
            creep,
            'action:' + (actionIntent || 'withdraw'),
            actionIntent || 'withdraw'
        );
        return true;
    }

    return result == OK;
}

function pickupTarget(creep, target) {
    releaseEnergyQueue(creep);
    var result = creep.pickup(target);
    if(result == ERR_NOT_IN_RANGE) {
        moveTo(creep, target, '#ffaa00', 'go pickup', 'move:pickup');
        return true;
    }

    if(result == OK) {
        announceIntent(creep, 'action:pickup', 'pickup');
        return true;
    }

    return result == OK;
}

function rememberHarvestPosition(creep, source) {
    creep.memory.lastHarvestPosition = {
        x: creep.pos.x,
        y: creep.pos.y,
        roomName: creep.pos.roomName,
        sourceX: source.pos.x,
        sourceY: source.pos.y,
        sourceRoomName: source.pos.roomName
    };
}

function harvestTarget(creep, target) {
    var result = creep.harvest(target);
    if(result == ERR_NOT_IN_RANGE) {
        moveTo(creep, target, '#ffaa00', 'go harvest', 'move:harvest');
        return true;
    }

    if(result == OK) {
        rememberHarvestPosition(creep, target);
        announceIntent(creep, 'action:harvest', 'harvest');
        return true;
    }

    return result == OK;
}

function harvestQueuedSource(creep) {
    var source = findQueuedSource(creep);
    if(!source) {
        return false;
    }

    var queue = joinSourceQueue(creep, source);
    var destination = getQueuedSourceDestination(creep, source, queue);
    var index = getQueueIndex(queue, creep.name);
    var harvestPositions = getAdjacentHarvestPositions(creep, source);
    var harvestPosition = index >= 0 && index < harvestPositions.length ? harvestPositions[index] : null;
    var canHarvestFromQueueSlot = harvestPosition && destination.isEqualTo(harvestPosition);

    if(!creep.pos.isEqualTo(destination)) {
        debug.log(
            'debugRoles',
            creep.name + ' moving to source queue ' + source.id + ' slot ' + (index + 1) +
                ' at ' + destination.roomName + ':' + destination.x + ',' + destination.y,
            5
        );
        moveTo(
            creep,
            destination,
            canHarvestFromQueueSlot ? '#ffaa00' : '#66ccff',
            canHarvestFromQueueSlot ? 'go harvest' : 'queue',
            canHarvestFromQueueSlot ? 'move:harvest' : 'move:queue'
        );
        return true;
    }

    if(canHarvestFromQueueSlot && source.energy > 0) {
        return harvestTarget(creep, source);
    }

    debug.log(
        'debugRoles',
        creep.name + ' waiting in source queue ' + source.id +
            ' slot ' + (index + 1) +
            ' energy=' + source.energy,
        5
    );
    announceIntent(creep, 'action:waitEnergy', 'wait');
    return true;
}

function findStoredEnergy(creep) {
    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: function(structure) {
            if(!structure.store || structure.store[RESOURCE_ENERGY] <= 0) {
                return false;
            }

            return isSafeTarget(creep, structure) &&
                (structure.structureType == STRUCTURE_CONTAINER ||
                structure.structureType == STRUCTURE_STORAGE);
        }
    });
}

function findDroppedEnergy(creep) {
    return creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: function(resource) {
            return resource.resourceType == RESOURCE_ENERGY &&
                resource.amount > 0 &&
                isSafeTarget(creep, resource);
        }
    });
}

function findTombstoneEnergy(creep) {
    if(typeof FIND_TOMBSTONES === 'undefined') {
        return null;
    }

    return creep.pos.findClosestByPath(FIND_TOMBSTONES, {
        filter: function(tombstone) {
            return tombstone.store &&
                tombstone.store[RESOURCE_ENERGY] > 0 &&
                isSafeTarget(creep, tombstone);
        }
    });
}

function findRuinEnergy(creep) {
    if(typeof FIND_RUINS === 'undefined') {
        return null;
    }

    return creep.pos.findClosestByPath(FIND_RUINS, {
        filter: function(ruin) {
            return ruin.store &&
                ruin.store[RESOURCE_ENERGY] > 0 &&
                isSafeTarget(creep, ruin);
        }
    });
}

function collectEnergy(creep, options) {
    options = options || {};

    if(creep.store.getFreeCapacity() === 0) {
        releaseEnergyQueue(creep);
        return true;
    }

    var tombstone = findTombstoneEnergy(creep);
    if(tombstone) {
        debug.log('debugRoles', creep.name + ' looting tombstone energy in ' + creep.room.name, 5);
        return withdrawFromTarget(creep, tombstone, 'go loot', 'loot');
    }

    var ruin = findRuinEnergy(creep);
    if(ruin) {
        debug.log('debugRoles', creep.name + ' looting ruin energy in ' + creep.room.name, 5);
        return withdrawFromTarget(creep, ruin, 'go loot', 'loot');
    }

    var droppedEnergy = findDroppedEnergy(creep);
    if(droppedEnergy) {
        return pickupTarget(creep, droppedEnergy);
    }

    if(options.preferHarvest) {
        return harvestQueuedSource(creep);
    }

    var storedEnergy = findStoredEnergy(creep);
    if(storedEnergy) {
        return withdrawFromTarget(creep, storedEnergy);
    }

    var source = findNearestSource(creep);
    if(source) {
        return harvestQueuedSource(creep);
    }

    debug.log('debugRoles', creep.name + ' has no energy source in ' + creep.room.name, 5);
    return false;
}

function transferEnergy(creep, target) {
    if(!isSafeTarget(creep, target)) {
        debug.log('debugDefense', creep.name + ' avoiding unsafe transfer target', 5);
        announceIntent(creep, 'action:avoidUnsafe', 'avoid');
        return false;
    }

    var result = creep.transfer(target, RESOURCE_ENERGY);
    if(result == ERR_NOT_IN_RANGE) {
        moveTo(creep, target, '#ffffff', 'go fill', 'move:fill');
        return true;
    }

    if(result == OK) {
        announceIntent(creep, 'action:transfer', 'fill');
        return true;
    }

    return result == OK;
}

function upgrade(creep) {
    if(!creep.room.controller) {
        return false;
    }

    if(!isSafeTarget(creep, creep.room.controller)) {
        debug.log('debugDefense', creep.name + ' avoiding unsafe controller upgrade', 5);
        announceIntent(creep, 'action:avoidUnsafe', 'avoid');
        return false;
    }

    var result = creep.upgradeController(creep.room.controller);
    if(result == ERR_NOT_IN_RANGE) {
        moveTo(creep, creep.room.controller, '#ffffff', 'go upgrade', 'move:upgrade');
        return true;
    }

    if(result == OK) {
        announceIntent(creep, 'action:upgrade', 'upgrade');
        return true;
    }

    return result == OK;
}

module.exports = {
    announceIntent: announceIntent,
    collectEnergy: collectEnergy,
    isSafeTarget: isSafeTarget,
    moveTo: moveTo,
    releaseEnergyQueue: releaseEnergyQueue,
    retreatFromHostiles: retreatFromHostiles,
    transferEnergy: transferEnergy,
    updateWorkingState: updateWorkingState,
    upgrade: upgrade
};
