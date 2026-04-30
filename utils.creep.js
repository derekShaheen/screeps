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

function sameMoveTarget(a, b) {
    return a &&
        b &&
        a.x == b.x &&
        a.y == b.y &&
        a.roomName == b.roomName;
}

function getMoveTargetPos(target) {
    if(!target) {
        return null;
    }

    if(target.pos) {
        return target.pos;
    }

    if(target.x !== undefined && target.y !== undefined && target.roomName) {
        return target;
    }

    return null;
}

function updateStuckState(creep, target) {
    var targetPos = getMoveTargetPos(target);
    if(!targetPos) {
        delete creep.memory.moveState;
        return 0;
    }

    var currentPos = {
        x: creep.pos.x,
        y: creep.pos.y,
        roomName: creep.pos.roomName
    };
    var nextTarget = {
        x: targetPos.x,
        y: targetPos.y,
        roomName: targetPos.roomName
    };
    var state = creep.memory.moveState || {};
    var stuckTicks = 0;

    if(sameMoveTarget(state.target, nextTarget) &&
        sameMoveTarget(state.pos, currentPos)) {
        stuckTicks = (state.stuckTicks || 0) + 1;
    }

    creep.memory.moveState = {
        target: nextTarget,
        pos: currentPos,
        stuckTicks: stuckTicks
    };

    return stuckTicks;
}

function getStuckTicks(creep) {
    if(!creep.memory.moveState) {
        return 0;
    }

    return creep.memory.moveState.stuckTicks || 0;
}

function isWalkableMovePosition(creep, pos) {
    if(pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49) {
        return false;
    }

    if(creep.room.getTerrain().get(pos.x, pos.y) == TERRAIN_MASK_WALL) {
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
        var type = structures[j].structureType;
        if(type != STRUCTURE_ROAD &&
            type != STRUCTURE_CONTAINER &&
            type != STRUCTURE_RAMPART) {
            return false;
        }
    }

    return true;
}

function findStepAsidePosition(creep, target) {
    var targetPos = getMoveTargetPos(target);
    var candidates = [];

    for(var dx = -1; dx <= 1; dx++) {
        for(var dy = -1; dy <= 1; dy++) {
            if(dx === 0 && dy === 0) {
                continue;
            }

            var pos = new RoomPosition(creep.pos.x + dx, creep.pos.y + dy, creep.pos.roomName);
            if(isWalkableMovePosition(creep, pos)) {
                candidates.push(pos);
            }
        }
    }

    if(!candidates.length) {
        return null;
    }

    candidates.sort(function(a, b) {
        if(targetPos) {
            var rangeDiff = a.getRangeTo(targetPos) - b.getRangeTo(targetPos);
            if(rangeDiff !== 0) {
                return rangeDiff;
            }
        }

        if(a.x != b.x) {
            return a.x - b.x;
        }

        return a.y - b.y;
    });

    return candidates[0];
}

function moveTo(creep, target, stroke, intentMessage, intentKey) {
    announceIntent(creep, intentKey || ('move:' + intentMessage), intentMessage);

    var stuckTicks = updateStuckState(creep, target);
    var options = {
        reusePath: 5
    };

    if(stuckTicks >= 2) {
        options.reusePath = 0;
        options.ignoreCreeps = true;
        debug.log('debugRoles', creep.name + ' repathing through traffic after ' + stuckTicks + ' stuck ticks', 5);
    }

    if(stuckTicks >= 8 && stuckTicks % 3 === 0) {
        var stepAside = findStepAsidePosition(creep, target);
        if(stepAside) {
            debug.log(
                'debugRoles',
                creep.name + ' stepping aside from traffic to ' +
                    stepAside.roomName + ':' + stepAside.x + ',' + stepAside.y,
                3
            );
            return creep.move(creep.pos.getDirectionTo(stepAside));
        }
    }

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

function getTargetPos(target) {
    if(!target) {
        return null;
    }

    if(target.pos) {
        return target.pos;
    }

    if(target.x !== undefined && target.y !== undefined && target.roomName) {
        return target;
    }

    return null;
}

function getDecayTicks(target) {
    if(!target) {
        return null;
    }

    if(typeof target.ticksToLive == 'number') {
        return target.ticksToLive;
    }

    if(typeof target.ticksToDecay == 'number') {
        return target.ticksToDecay;
    }

    return null;
}

function getTravelTicks(creep, target, range) {
    var targetPos = getTargetPos(target);
    var targetRange = range === undefined ? 1 : range;

    if(!creep || !creep.pos || !targetPos) {
        return 0;
    }

    if(creep.pos.inRangeTo(targetPos, targetRange)) {
        return 0;
    }

    var path = creep.pos.findPathTo(targetPos, {
        ignoreCreeps: true,
        range: targetRange
    });

    if(!path.length) {
        return null;
    }

    return path.length;
}

function canReachBeforeDecay(creep, target, range) {
    var targetPos = getTargetPos(target);
    if(!creep || !creep.pos || !targetPos) {
        return true;
    }

    var sourceTicks = getDecayTicks(creep);
    var targetTicks = getDecayTicks(target);
    if(sourceTicks === null && targetTicks === null) {
        return true;
    }

    var targetRange = range === undefined ? 1 : range;
    var minimumTravelTicks = 0;
    if(creep.pos.roomName == targetPos.roomName) {
        minimumTravelTicks = Math.max(0, creep.pos.getRangeTo(targetPos) - targetRange);
    }
    if((sourceTicks !== null && sourceTicks <= minimumTravelTicks) ||
        (targetTicks !== null && targetTicks <= minimumTravelTicks)) {
        return false;
    }

    var travelTicks = getTravelTicks(creep, targetPos, targetRange);
    if(travelTicks === null) {
        return false;
    }

    return (sourceTicks === null || sourceTicks > travelTicks) &&
        (targetTicks === null || targetTicks > travelTicks);
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
    releaseEnergyReservation(creep);
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
            releaseEnergyReservation(creep);
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
            return isSafeTarget(creep, source) &&
                canReachBeforeDecay(creep, source, 1);
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
        delete creep.memory.queueDestination;
        return;
    }

    var queues = getRoomSourceQueues(creep.room);
    for(var sourceId in queues) {
        removeNameFromQueue(queues[sourceId], creep.name);
    }

    delete creep.memory.energySourceId;
    delete creep.memory.queueDestination;
}

function getRoomEnergyReservations(room) {
    if(!room.memory.energyReservations) {
        room.memory.energyReservations = {};
    }

    return room.memory.energyReservations;
}

function removeEnergyReservation(room, targetId, creepName) {
    if(!room || !room.memory || !room.memory.energyReservations || !targetId) {
        return;
    }

    var reservations = room.memory.energyReservations;
    if(!reservations[targetId]) {
        return;
    }

    delete reservations[targetId][creepName];
    if(Object.keys(reservations[targetId]).length === 0) {
        delete reservations[targetId];
    }
}

function releaseEnergyReservation(creep) {
    if(!creep.memory.energyReservation) {
        return;
    }

    removeEnergyReservation(creep.room, creep.memory.energyReservation.targetId, creep.name);
    delete creep.memory.energyReservation;
}

function pruneEnergyReservations(room) {
    var reservations = getRoomEnergyReservations(room);
    for(var targetId in reservations) {
        var target = Game.getObjectById(targetId);
        if(!target || !target.store || target.store[RESOURCE_ENERGY] <= 0) {
            delete reservations[targetId];
            continue;
        }

        for(var creepName in reservations[targetId]) {
            var reservedCreep = Game.creeps[creepName];
            if(!reservedCreep ||
                reservedCreep.room.name != room.name ||
                reservedCreep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 ||
                reservedCreep.memory.working) {
                delete reservations[targetId][creepName];
                if(reservedCreep &&
                    reservedCreep.memory.energyReservation &&
                    reservedCreep.memory.energyReservation.targetId == targetId) {
                    delete reservedCreep.memory.energyReservation;
                }
            }
        }

        if(Object.keys(reservations[targetId]).length === 0) {
            delete reservations[targetId];
        }
    }
}

function getReservedEnergy(room, targetId, exceptCreepName) {
    pruneEnergyReservations(room);

    var reservations = getRoomEnergyReservations(room);
    var reserved = 0;
    if(!reservations[targetId]) {
        return reserved;
    }

    for(var creepName in reservations[targetId]) {
        if(creepName != exceptCreepName) {
            reserved += reservations[targetId][creepName];
        }
    }

    return reserved;
}

function getAvailableStoredEnergy(creep, target) {
    if(!target || !target.store) {
        return 0;
    }

    return Math.max(0, target.store[RESOURCE_ENERGY] - getReservedEnergy(creep.room, target.id, creep.name));
}

function getLinkRole(room, link) {
    if(!room || !room.memory || !room.memory.linkRoles || !link) {
        return null;
    }

    return room.memory.linkRoles[link.id] || null;
}

function isSourceLink(room, link) {
    return getLinkRole(room, link) == 'source';
}

function reserveEnergyTarget(creep, target) {
    if(!target ||
        !target.id ||
        !target.store ||
        !isSafeTarget(creep, target) ||
        !canReachBeforeDecay(creep, target, 1)) {
        return false;
    }

    if(creep.memory.energyReservation &&
        creep.memory.energyReservation.targetId != target.id) {
        releaseEnergyReservation(creep);
    }

    var amount = Math.min(
        creep.store.getFreeCapacity(RESOURCE_ENERGY),
        getAvailableStoredEnergy(creep, target)
    );

    if(amount <= 0) {
        releaseEnergyReservation(creep);
        return false;
    }

    var reservations = getRoomEnergyReservations(creep.room);
    if(!reservations[target.id]) {
        reservations[target.id] = {};
    }

    reservations[target.id][creep.name] = amount;
    creep.memory.energyReservation = {
        targetId: target.id,
        amount: amount,
        tick: Game.time
    };

    return true;
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

function getOpenHarvestPositions(creep, source) {
    var positions = getAdjacentHarvestPositions(creep, source);
    var openPositions = [];

    for(var i = 0; i < positions.length; i++) {
        if(isWalkableHarvestPosition(positions[i], creep, false)) {
            openPositions.push(positions[i]);
        }
    }

    return openPositions;
}

function getQueueHarvestPositions(creep, source) {
    return getAdjacentHarvestPositions(creep, source);
}

function getWaitingPositions(creep, source) {
    var positions = [];
    for(var range = 3; range <= 5; range++) {
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
                if(isWalkableHarvestPosition(pos, creep, true)) {
                    positions.push(pos);
                }
            }
        }
    }

    positions.sort(function(a, b) {
        var sourceRangeDiff = b.getRangeTo(source) - a.getRangeTo(source);
        if(sourceRangeDiff !== 0) {
            return sourceRangeDiff;
        }

        if(a.x != b.x) {
            return a.x - b.x;
        }

        return a.y - b.y;
    });

    return positions;
}

function rememberQueueDestination(creep, source, index, destination) {
    var previous = creep.memory.queueDestination;
    if(previous &&
        previous.sourceId == source.id &&
        previous.slot == index &&
        (previous.x != destination.x ||
        previous.y != destination.y ||
        previous.roomName != destination.roomName)) {
        debug.log(
            'debugRoles',
            creep.name + ' source queue slot ' + (index + 1) +
                ' moved from ' + previous.roomName + ':' + previous.x + ',' + previous.y +
                ' to ' + destination.roomName + ':' + destination.x + ',' + destination.y,
            3
        );
    }

    creep.memory.queueDestination = {
        sourceId: source.id,
        slot: index,
        x: destination.x,
        y: destination.y,
        roomName: destination.roomName
    };
}

function getQueuedSourceDestination(creep, source, queue) {
    var index = getQueueIndex(queue, creep.name);
    var harvestPositions = getQueueHarvestPositions(creep, source);
    var destination;

    if(index >= 0 && index < harvestPositions.length) {
        destination = harvestPositions[index];
        rememberQueueDestination(creep, source, index, destination);
        return destination;
    }

    var waitingPositions = getWaitingPositions(creep, source);
    if(waitingPositions.length) {
        var waitingIndex = Math.max(index - harvestPositions.length, 0);
        destination = waitingPositions[waitingIndex % waitingPositions.length];
        rememberQueueDestination(creep, source, index, destination);
        return destination;
    }

    destination = source.pos;
    rememberQueueDestination(creep, source, index, destination);
    return destination;
}

function getProjectedSourceQueueLoad(creep, source) {
    var queue = pruneSourceQueue(creep.room, source);
    var load = 1;

    for(var i = 0; i < queue.creeps.length; i++) {
        if(queue.creeps[i] != creep.name) {
            load++;
        }
    }

    return load;
}

function getSourceHarvestCapacity(creep, source) {
    return Math.max(getQueueHarvestPositions(creep, source).length, 1);
}

function sourceQueueScore(creep, source) {
    if(!isSafeTarget(creep, source) ||
        !canReachBeforeDecay(creep, source, 1)) {
        return 9999 + creep.pos.getRangeTo(source);
    }

    var load = getProjectedSourceQueueLoad(creep, source);
    var harvestCapacity = getSourceHarvestCapacity(creep, source);
    var waitingPenalty = Math.max(load - harvestCapacity, 0) * 30;
    var pressurePenalty = (load / harvestCapacity) * 8;
    var energyBonus = source.energy > 0 ? -4 : 20;

    return creep.pos.getRangeTo(source) + pressurePenalty + waitingPenalty + energyBonus;
}

function isAvoidingSource(creep, source) {
    return creep.memory.avoidEnergySourceId == source.id &&
        creep.memory.avoidEnergySourceUntil &&
        Game.time < creep.memory.avoidEnergySourceUntil;
}

function avoidSourceTemporarily(creep, source) {
    creep.memory.avoidEnergySourceId = source.id;
    creep.memory.avoidEnergySourceUntil = Game.time + 50;
    delete creep.memory.moveState;
    releaseEnergyQueue(creep);
}

function findQueuedSource(creep) {
    var sources = creep.room.find(FIND_SOURCES, {
        filter: function(source) {
            return isSafeTarget(creep, source) &&
                canReachBeforeDecay(creep, source, 1) &&
                !isAvoidingSource(creep, source);
        }
    });
    if(!sources.length) {
        return null;
    }

    sources.sort(function(a, b) {
        return sourceQueueScore(creep, a) - sourceQueueScore(creep, b);
    });

    if(creep.memory.energySourceId) {
        var existingSource = Game.getObjectById(creep.memory.energySourceId);
        if(existingSource &&
            existingSource.room.name == creep.room.name &&
            isSafeTarget(creep, existingSource) &&
            canReachBeforeDecay(creep, existingSource, 1) &&
            !isAvoidingSource(creep, existingSource)) {
            var bestSource = sources[0];
            var existingQueue = pruneSourceQueue(creep.room, existingSource);
            var existingIndex = getQueueIndex(existingQueue, creep.name);
            var existingCapacity = getSourceHarvestCapacity(creep, existingSource);
            var alreadyHarvesting = existingIndex >= 0 &&
                existingIndex < existingCapacity &&
                creep.pos.inRangeTo(existingSource, 1);
            var existingScore = sourceQueueScore(creep, existingSource);
            var bestScore = sourceQueueScore(creep, bestSource);

            if(alreadyHarvesting || bestSource.id == existingSource.id || bestScore + 15 >= existingScore) {
                return existingSource;
            }

            debug.log(
                'debugRoles',
                creep.name + ' switching energy source from ' + existingSource.id +
                    ' to ' + bestSource.id +
                    ' scores ' + Math.round(existingScore) + ' -> ' + Math.round(bestScore),
                3
            );
            return bestSource;
        }

        releaseEnergyQueue(creep);
    }

    return sources[0];
}

function withdrawFromTarget(creep, target, moveIntent, actionIntent) {
    releaseEnergyQueue(creep);
    if(!canReachBeforeDecay(creep, target, 1)) {
        releaseEnergyReservation(creep);
        debug.log('debugRoles', creep.name + ' skipped decaying energy target', 5);
        return false;
    }

    if(target.store &&
        (!creep.memory.energyReservation ||
        creep.memory.energyReservation.targetId != target.id) &&
        !reserveEnergyTarget(creep, target)) {
        debug.log('debugRoles', creep.name + ' skipped reserved energy target', 5);
        return false;
    }

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
        releaseEnergyReservation(creep);
        announceIntent(
            creep,
            'action:' + (actionIntent || 'withdraw'),
            actionIntent || 'withdraw'
        );
        return true;
    }

    if(result == ERR_NOT_ENOUGH_RESOURCES || result == ERR_INVALID_TARGET) {
        releaseEnergyReservation(creep);
    }

    return result == OK;
}

function pickupTarget(creep, target) {
    releaseEnergyQueue(creep);
    releaseEnergyReservation(creep);
    if(!canReachBeforeDecay(creep, target, 1)) {
        debug.log('debugRoles', creep.name + ' skipped decaying pickup target', 5);
        return false;
    }

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
    releaseEnergyReservation(creep);
    if(!canReachBeforeDecay(creep, target, 1)) {
        debug.log('debugRoles', creep.name + ' skipped unreachable harvest target before decay', 5);
        return false;
    }

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
    releaseEnergyReservation(creep);

    var source = findQueuedSource(creep);
    if(!source) {
        return false;
    }

    var queue = joinSourceQueue(creep, source);
    var destination = getQueuedSourceDestination(creep, source, queue);
    var index = getQueueIndex(queue, creep.name);
    var harvestPositions = getQueueHarvestPositions(creep, source);
    var harvestPosition = index >= 0 && index < harvestPositions.length ? harvestPositions[index] : null;
    var canHarvestFromQueueSlot = harvestPosition && destination.isEqualTo(harvestPosition);

    if(!canReachBeforeDecay(creep, destination, 0)) {
        debug.log('debugRoles', creep.name + ' skipped source queue destination that will decay before arrival', 5);
        releaseEnergyQueue(creep);
        return false;
    }

    if(!creep.pos.isEqualTo(destination)) {
        if(!canHarvestFromQueueSlot && getStuckTicks(creep) >= 10) {
            debug.log(
                'debugRoles',
                creep.name + ' leaving crowded source queue ' + source.id +
                    ' after ' + getStuckTicks(creep) + ' stuck ticks',
                3
            );
            avoidSourceTemporarily(creep, source);
            return false;
        }

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
    if(creep.memory.energyReservation) {
        var reservedTarget = Game.getObjectById(creep.memory.energyReservation.targetId);
        if(reservedTarget &&
            reservedTarget.room.name == creep.room.name &&
            reservedTarget.store &&
            reservedTarget.store[RESOURCE_ENERGY] > 0 &&
            isSafeTarget(creep, reservedTarget) &&
            canReachBeforeDecay(creep, reservedTarget, 1)) {
            return reservedTarget;
        }

        releaseEnergyReservation(creep);
    }

    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: function(structure) {
            if(!structure.store || getAvailableStoredEnergy(creep, structure) <= 0) {
                return false;
            }

            if(structure.structureType == STRUCTURE_LINK) {
                var linkRole = getLinkRole(creep.room, structure);
                if(linkRole == 'source' || (linkRole == 'controller' && creep.memory.role != 'upgrader')) {
                    return false;
                }
            }

            return isSafeTarget(creep, structure) &&
                canReachBeforeDecay(creep, structure, 1) &&
                (structure.structureType == STRUCTURE_CONTAINER ||
                structure.structureType == STRUCTURE_STORAGE ||
                structure.structureType == STRUCTURE_LINK);
        }
    });
}

function findDroppedEnergy(creep) {
    return creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: function(resource) {
            return resource.resourceType == RESOURCE_ENERGY &&
                resource.amount > 0 &&
                isSafeTarget(creep, resource) &&
                canReachBeforeDecay(creep, resource, 1);
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
                getAvailableStoredEnergy(creep, tombstone) > 0 &&
                isSafeTarget(creep, tombstone) &&
                canReachBeforeDecay(creep, tombstone, 1);
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
                getAvailableStoredEnergy(creep, ruin) > 0 &&
                isSafeTarget(creep, ruin) &&
                canReachBeforeDecay(creep, ruin, 1);
        }
    });
}

function collectEnergy(creep, options) {
    options = options || {};

    if(creep.store.getFreeCapacity() === 0) {
        releaseEnergyQueue(creep);
        releaseEnergyReservation(creep);
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

    if(options.allowStored !== false) {
        var storedEnergy = findStoredEnergy(creep);
        if(storedEnergy && reserveEnergyTarget(creep, storedEnergy)) {
            return withdrawFromTarget(creep, storedEnergy);
        }
    }

    if(options.allowHarvest === false) {
        debug.log('debugRoles', creep.name + ' found no stored energy and is not allowed to harvest', 5);
        return false;
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

    if(!canReachBeforeDecay(creep, target, 1)) {
        debug.log('debugRoles', creep.name + ' skipped transfer target that will decay before arrival', 5);
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

    if(!canReachBeforeDecay(creep, creep.room.controller, 3)) {
        debug.log('debugRoles', creep.name + ' cannot reach controller before decay', 5);
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
    canReachBeforeDecay: canReachBeforeDecay,
    collectEnergy: collectEnergy,
    getAvailableStoredEnergy: getAvailableStoredEnergy,
    getLinkRole: getLinkRole,
    isSourceLink: isSourceLink,
    isSafeTarget: isSafeTarget,
    moveTo: moveTo,
    releaseEnergyReservation: releaseEnergyReservation,
    releaseEnergyQueue: releaseEnergyQueue,
    reserveEnergyTarget: reserveEnergyTarget,
    retreatFromHostiles: retreatFromHostiles,
    transferEnergy: transferEnergy,
    updateWorkingState: updateWorkingState,
    upgrade: upgrade
};
