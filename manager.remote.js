var creepUtils = require('utils.creep');
var debug = require('utils.debug');

var DEFAULT_SETTINGS = {
    enabled: true,
    maxRooms: 2,
    minHomeRcl: 3,
    claimMinHomeRcl: 6,
    minHaulEnergy: 300,
    reserveRenewBelow: 1200,
    staleRoomTicks: 1500,
    unsafeRoomCooldown: 5000,
    exitAccessCacheTicks: 100,
    priorityFlagName: 'Flag1'
};

var REMOTE_HAULERS_PER_MINER = 1;
var MIN_UNSAFE_ROOM_COOLDOWN = 5000;

function getSettings(room) {
    if(!room.memory.remote) {
        room.memory.remote = {};
    }

    for(var key in DEFAULT_SETTINGS) {
        if(room.memory.remote[key] === undefined) {
            room.memory.remote[key] = DEFAULT_SETTINGS[key];
        }
    }

    if(!room.memory.remote.rooms) {
        room.memory.remote.rooms = {};
    }

    return room.memory.remote;
}

function getMyUsername() {
    for(var name in Game.spawns) {
        return Game.spawns[name].owner.username;
    }

    return null;
}

function getOwnedRooms() {
    var rooms = [];
    for(var roomName in Game.rooms) {
        var room = Game.rooms[roomName];
        if(room.controller && room.controller.my) {
            rooms.push(room);
        }
    }

    return rooms;
}

function getUnsafeRoomMemory() {
    if(!Memory.remote) {
        Memory.remote = {};
    }

    if(!Memory.remote.unsafeRooms) {
        Memory.remote.unsafeRooms = {};
    }

    return Memory.remote.unsafeRooms;
}

function getUnsafeRoomRecord(roomName) {
    var unsafeRooms = getUnsafeRoomMemory();
    var record = unsafeRooms[roomName];
    if(record && record.unsafeUntil && record.unsafeUntil <= Game.time) {
        delete unsafeRooms[roomName];
        return null;
    }

    return record || null;
}

function isGloballyUnsafeRoom(roomName) {
    return !!getUnsafeRoomRecord(roomName);
}

function clearGlobalUnsafeRoom(roomName) {
    var unsafeRooms = getUnsafeRoomMemory();
    if(unsafeRooms[roomName]) {
        delete unsafeRooms[roomName];
    }
}

function getUnsafeCooldown(settings) {
    var cooldown = settings && typeof settings.unsafeRoomCooldown == 'number' ?
        settings.unsafeRoomCooldown :
        DEFAULT_SETTINGS.unsafeRoomCooldown;

    return Math.max(MIN_UNSAFE_ROOM_COOLDOWN, cooldown);
}

function isThreateningHostile(creep) {
    return creep.getActiveBodyparts(ATTACK) > 0 ||
        creep.getActiveBodyparts(RANGED_ATTACK) > 0;
}

function hasThreats(room) {
    return room.find(FIND_HOSTILE_CREEPS, {
        filter: isThreateningHostile
    }).length > 0;
}

function hasHostileTower(room) {
    return room.find(FIND_HOSTILE_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_TOWER &&
                (!structure.isActive || structure.isActive());
        }
    }).length > 0;
}

function getHarvestBlockReason(room) {
    if(!room.controller) {
        return 'no controller';
    }

    var username = getMyUsername();
    if(room.controller.owner && !room.controller.my) {
        return 'controller owned by ' + room.controller.owner.username;
    }

    if(room.controller.reservation &&
        username &&
        room.controller.reservation.username != username) {
        return 'controller reserved by ' + room.controller.reservation.username;
    }

    return null;
}

function canHarvestRemoteRoom(room) {
    return !getHarvestBlockReason(room) &&
        !hasThreats(room) &&
        !hasHostileTower(room);
}

function rememberUnsafeRemote(settings, remoteMemory, remoteName, reason) {
    var attempts = (remoteMemory.unsafeAttempts || 0) + 1;
    var cooldown = getUnsafeCooldown(settings);
    var unsafeUntil = Game.time + cooldown * Math.min(attempts, 10);

    remoteMemory.status = 'unsafe';
    remoteMemory.reason = reason || 'hostile threat';
    remoteMemory.unsafeAttempts = attempts;
    remoteMemory.unsafeUntil = unsafeUntil;

    getUnsafeRoomMemory()[remoteName] = {
        reason: remoteMemory.reason,
        unsafeUntil: unsafeUntil,
        attempts: attempts,
        lastSeen: Game.time
    };
}

function isPersistentRemoteBlockReason(reason) {
    if(!reason) {
        return false;
    }

    return reason == 'hostile tower' ||
        reason == 'no controller' ||
        reason.indexOf('controller owned by ') === 0 ||
        reason.indexOf('controller reserved by ') === 0;
}

function getRoomLinearDistance(homeRoomName, targetRoomName) {
    if(typeof Game.map.getRoomLinearDistance != 'function') {
        return 1;
    }

    return Game.map.getRoomLinearDistance(homeRoomName, targetRoomName);
}

function getApproxRange(fromPos, toPos) {
    if(!fromPos || !toPos) {
        return 9999;
    }

    if(fromPos.roomName == toPos.roomName) {
        return fromPos.getRangeTo(toPos);
    }

    return getRoomLinearDistance(fromPos.roomName, toPos.roomName) * 50 +
        Math.max(Math.abs(fromPos.x - toPos.x), Math.abs(fromPos.y - toPos.y));
}

function isUnsafeVisibleRoom(room) {
    return !!room && (hasThreats(room) || hasHostileTower(room));
}

function shouldAvoidTravelRoom(homeRoomName, roomName, destinationRoomName) {
    if(!roomName || roomName == destinationRoomName || roomName == homeRoomName) {
        return false;
    }

    if(isGloballyUnsafeRoom(roomName)) {
        return true;
    }

    var visibleRoom = Game.rooms[roomName];
    if(isUnsafeVisibleRoom(visibleRoom)) {
        return true;
    }

    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom) {
        return false;
    }

    var settings = getSettings(homeRoom);
    var remoteMemory = settings.rooms && settings.rooms[roomName] ? settings.rooms[roomName] : null;
    return !!remoteMemory &&
        ((remoteMemory.unsafeUntil && remoteMemory.unsafeUntil > Game.time) ||
        remoteMemory.status == 'unsafe' ||
        (remoteMemory.status == 'unknown' &&
            (remoteMemory.reason == 'combat hostile' || remoteMemory.reason == 'hostile tower')));
}

function getRemoteTravelOptions(homeRoomName, destinationRoomName) {
    return {
        routeCallback: function(roomName) {
            if(shouldAvoidTravelRoom(homeRoomName, roomName, destinationRoomName)) {
                return Infinity;
            }

            return 1;
        }
    };
}

function moveToRoom(creep, roomName, stroke, intentMessage, intentKey) {
    if(!creep || !roomName) {
        return false;
    }

    return creepUtils.moveTo(
        creep,
        new RoomPosition(25, 25, roomName),
        stroke,
        intentMessage,
        intentKey,
        getRemoteTravelOptions(creep.memory.homeRoom || creep.room.name, roomName)
    );
}

function getClosestByApproxRange(fromPos, targets) {
    if(!targets.length) {
        return null;
    }

    targets.sort(function(a, b) {
        return getApproxRange(fromPos, a.pos) - getApproxRange(fromPos, b.pos);
    });

    return targets[0];
}

function getMapRoomStatus(roomName) {
    if(!Game.map.getRoomStatus) {
        return 'normal';
    }

    var status = Game.map.getRoomStatus(roomName);
    return status && status.status ? status.status : 'normal';
}

function isAccessibleMapRoom(roomName) {
    return getMapRoomStatus(roomName) == 'normal';
}

function isAccessibleRemoteMapRoom(homeRoomName, remoteRoomName) {
    var remoteStatus = getMapRoomStatus(remoteRoomName);
    if(remoteStatus == 'normal') {
        return true;
    }

    return !!homeRoomName &&
        remoteStatus == 'novice' &&
        getMapRoomStatus(homeRoomName) == 'novice';
}

function hasPriorityRemoteFlag(roomName, settings) {
    var flagName = settings && settings.priorityFlagName ?
        settings.priorityFlagName :
        DEFAULT_SETTINGS.priorityFlagName;
    var flag = Game.flags[flagName];

    return !!flag && flag.pos.roomName == roomName;
}

function getPrimaryHomeAnchor(room) {
    var spawns = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    return spawns[0] || room.controller || null;
}

function isPassableStructure(structure) {
    if(structure.structureType == STRUCTURE_ROAD ||
        structure.structureType == STRUCTURE_CONTAINER) {
        return true;
    }

    return structure.structureType == STRUCTURE_RAMPART &&
        (structure.my || structure.isPublic);
}

function addExitAccessCosts(room, costs) {
    var structures = room.find(FIND_STRUCTURES);
    for(var i = 0; i < structures.length; i++) {
        if(structures[i].structureType == STRUCTURE_ROAD) {
            costs.set(structures[i].pos.x, structures[i].pos.y, 1);
            continue;
        }

        if(structures[i].structureType == STRUCTURE_CONTAINER ||
            (structures[i].structureType == STRUCTURE_RAMPART &&
            (structures[i].my || structures[i].isPublic))) {
            costs.set(structures[i].pos.x, structures[i].pos.y, 2);
            continue;
        }

        costs.set(structures[i].pos.x, structures[i].pos.y, 255);
    }

    var sites = room.find(FIND_CONSTRUCTION_SITES);
    for(var j = 0; j < sites.length; j++) {
        if(sites[j].structureType == STRUCTURE_ROAD) {
            costs.set(sites[j].pos.x, sites[j].pos.y, 1);
            continue;
        }

        if(sites[j].structureType == STRUCTURE_RAMPART && sites[j].my !== false) {
            costs.set(sites[j].pos.x, sites[j].pos.y, 2);
            continue;
        }

        if(sites[j].structureType == STRUCTURE_WALL) {
            costs.set(sites[j].pos.x, sites[j].pos.y, 255);
        }
    }
}

function getExitFindConstant(direction) {
    var value = parseInt(direction, 10);
    if(value == FIND_EXIT_TOP ||
        value == FIND_EXIT_RIGHT ||
        value == FIND_EXIT_BOTTOM ||
        value == FIND_EXIT_LEFT) {
        return value;
    }

    return null;
}

function hasOpenExitTile(room, exitPositions) {
    for(var i = 0; i < exitPositions.length; i++) {
        if(room.getTerrain().get(exitPositions[i].x, exitPositions[i].y) == TERRAIN_MASK_WALL) {
            continue;
        }

        var structures = exitPositions[i].lookFor(LOOK_STRUCTURES);
        var blocked = false;
        for(var j = 0; j < structures.length; j++) {
            if(!isPassableStructure(structures[j])) {
                blocked = true;
                break;
            }
        }

        if(!blocked) {
            return true;
        }
    }

    return false;
}

function canReachExit(room, exitPositions) {
    if(!exitPositions.length || typeof PathFinder === 'undefined') {
        return exitPositions.length > 0;
    }

    var anchor = getPrimaryHomeAnchor(room);
    if(!anchor) {
        return true;
    }

    var goals = [];
    for(var i = 0; i < exitPositions.length; i++) {
        goals.push({
            pos: exitPositions[i],
            range: 0
        });
    }

    var result = PathFinder.search(anchor.pos || anchor, goals, {
        plainCost: 2,
        swampCost: 10,
        maxRooms: 1,
        maxOps: 2000,
        roomCallback: function(roomName) {
            if(roomName != room.name) {
                return false;
            }

            var costs = new PathFinder.CostMatrix();
            addExitAccessCosts(room, costs);
            return costs;
        }
    });

    return !result.incomplete && result.path.length > 0;
}

function hasAccessibleExit(room, direction, remoteMemory, settings) {
    if(!direction) {
        return true;
    }

    var cacheTicks = typeof settings.exitAccessCacheTicks == 'number' ?
        Math.max(1, settings.exitAccessCacheTicks) :
        DEFAULT_SETTINGS.exitAccessCacheTicks;
    if(remoteMemory.exitAccessChecked &&
        remoteMemory.exitAccessible !== undefined &&
        Game.time - remoteMemory.exitAccessChecked < cacheTicks) {
        return remoteMemory.exitAccessible === true;
    }

    var findConstant = getExitFindConstant(direction);
    var exitPositions = findConstant === null ? [] : room.find(findConstant);
    var accessible = hasOpenExitTile(room, exitPositions) &&
        canReachExit(room, exitPositions);

    remoteMemory.exitAccessible = accessible;
    remoteMemory.exitAccessChecked = Game.time;
    return accessible;
}

function rememberAdjacentRooms(room, settings, homeRoomName) {
    if(typeof Game.map.describeExits != 'function') {
        return;
    }

    homeRoomName = homeRoomName || room.name;
    var exits = Game.map.describeExits(room.name) || {};
    for(var direction in exits) {
        var roomName = exits[direction];
        if(roomName == homeRoomName) {
            continue;
        }

        var mapStatus = getMapRoomStatus(roomName);
        var distance = getRoomLinearDistance(homeRoomName, roomName);
        if(!settings.rooms[roomName]) {
            settings.rooms[roomName] = {
                enabled: true,
                status: 'unknown',
                distance: distance,
                parentRoom: room.name
            };
        }

        if(settings.rooms[roomName].distance === undefined ||
            distance < settings.rooms[roomName].distance) {
            settings.rooms[roomName].distance = distance;
            settings.rooms[roomName].parentRoom = room.name;
        }

        settings.rooms[roomName].exit = direction;
        settings.rooms[roomName].mapStatus = mapStatus;
        if(!isAccessibleRemoteMapRoom(homeRoomName, roomName)) {
            settings.rooms[roomName].status = 'blocked';
            settings.rooms[roomName].reason = 'map status ' + mapStatus;
            continue;
        }

        if(!hasAccessibleExit(room, direction, settings.rooms[roomName], settings)) {
            settings.rooms[roomName].status = 'blocked';
            settings.rooms[roomName].reason = 'exit inaccessible';
            continue;
        }

        if(settings.rooms[roomName].status == 'blocked' &&
            settings.rooms[roomName].reason &&
            (settings.rooms[roomName].reason.indexOf('map status ') === 0 ||
            settings.rooms[roomName].reason == 'exit inaccessible')) {
            settings.rooms[roomName].status = 'unknown';
            delete settings.rooms[roomName].reason;
        }
    }
}

function updateVisibleRemoteRoom(homeRoom, remoteName, remoteMemory) {
    remoteMemory.mapStatus = getMapRoomStatus(remoteName);
    if(!isAccessibleRemoteMapRoom(homeRoom.name, remoteName)) {
        remoteMemory.status = 'blocked';
        remoteMemory.reason = 'map status ' + remoteMemory.mapStatus;
        return;
    }

    if(remoteMemory.exitAccessible === false) {
        remoteMemory.status = 'blocked';
        remoteMemory.reason = 'exit inaccessible';
        return;
    }

    var remoteRoom = Game.rooms[remoteName];
    if(!remoteRoom) {
        if(remoteMemory.lastScouted &&
            Game.time - remoteMemory.lastScouted > getSettings(homeRoom).staleRoomTicks) {
            remoteMemory.status = 'unknown';
            if(remoteMemory.unsafeAttempts > 0) {
                remoteMemory.unsafeAttempts = remoteMemory.unsafeAttempts - 1;
            }
        }
        return;
    }

    remoteMemory.lastScouted = Game.time;
    remoteMemory.distance = getRoomLinearDistance(homeRoom.name, remoteName);

    if(!remoteRoom.controller) {
        remoteMemory.status = 'blocked';
        remoteMemory.reason = 'no controller';
        delete remoteMemory.reservationUsername;
        remoteMemory.reservationTicks = 0;
        remoteMemory.reservationObservedTick = Game.time;
        return;
    }

    remoteMemory.reservationUsername = remoteRoom.controller.reservation ?
        remoteRoom.controller.reservation.username :
        null;
    remoteMemory.reservationTicks = remoteRoom.controller.reservation ?
        remoteRoom.controller.reservation.ticksToEnd :
        0;
    remoteMemory.reservationObservedTick = Game.time;

    var harvestBlockReason = getHarvestBlockReason(remoteRoom);
    if(harvestBlockReason) {
        remoteMemory.status = 'blocked';
        remoteMemory.reason = harvestBlockReason;
        return;
    }

    if(hasThreats(remoteRoom) || hasHostileTower(remoteRoom)) {
        var settings = getSettings(homeRoom);
        var reason = hasHostileTower(remoteRoom) ? 'hostile tower' : 'combat hostile';
        if(remoteMemory.status != 'unsafe' ||
            !remoteMemory.unsafeUntil ||
            Game.time >= remoteMemory.unsafeUntil ||
            !getUnsafeRoomRecord(remoteName)) {
            rememberUnsafeRemote(settings, remoteMemory, remoteName, reason);
        }
        return;
    }

    clearGlobalUnsafeRoom(remoteName);
    rememberAdjacentRooms(remoteRoom, getSettings(homeRoom), homeRoom.name);

    var sources = remoteRoom.find(FIND_SOURCES);
    if(!sources.length) {
        remoteMemory.status = 'empty';
        remoteMemory.sourceIds = [];
        return;
    }

    remoteMemory.status = 'ready';
    delete remoteMemory.reason;
    delete remoteMemory.unsafeAttempts;
    remoteMemory.sourceIds = sources.map(function(source) {
        return source.id;
    });
}

function updateRemoteMemory(room) {
    if(room._remoteMemoryCacheTick === Game.time) {
        return room.memory.remote;
    }
    room._remoteMemoryCacheTick = Game.time;

    var settings = getSettings(room);
    if(settings.enabled === false ||
        !room.controller ||
        room.controller.level < settings.minHomeRcl) {
        return settings;
    }

    rememberAdjacentRooms(room, settings, room.name);

    for(var remoteName in settings.rooms) {
        updateVisibleRemoteRoom(room, remoteName, settings.rooms[remoteName]);
    }

    return settings;
}

function canScoutRoom(room, remoteName, remoteMemory, settings) {
    if(!isAccessibleRemoteMapRoom(room.name, remoteName)) {
        return false;
    }

    if(isGloballyUnsafeRoom(remoteName)) {
        return false;
    }

    if(remoteMemory.exitAccessible === false) {
        return false;
    }

    if(remoteMemory.enabled === false) {
        return false;
    }

    if(remoteMemory.distance && remoteMemory.distance > settings.maxRooms) {
        return false;
    }

    if(remoteMemory.unsafeUntil && Game.time < remoteMemory.unsafeUntil) {
        return false;
    }

    if(isPersistentRemoteBlockReason(remoteMemory.reason)) {
        return false;
    }

    return remoteMemory.status == 'ready' || remoteMemory.status == 'unknown';
}

function canUseRemote(room, remoteName, remoteMemory, settings) {
    if(!isAccessibleRemoteMapRoom(room.name, remoteName)) {
        return false;
    }

    if(isGloballyUnsafeRoom(remoteName)) {
        return false;
    }

    if(remoteMemory.exitAccessible === false) {
        return false;
    }

    if(remoteMemory.enabled === false) {
        return false;
    }

    if(remoteMemory.distance && remoteMemory.distance > settings.maxRooms) {
        return false;
    }

    if(remoteMemory.unsafeUntil && Game.time < remoteMemory.unsafeUntil) {
        return false;
    }

    if(isPersistentRemoteBlockReason(remoteMemory.reason)) {
        return false;
    }

    if(remoteMemory.status == 'unknown' && remoteMemory.unsafeAttempts > 0) {
        return false;
    }

    return remoteMemory.status == 'ready' || remoteMemory.status == 'unknown';
}

function isRemoteUsable(homeRoomName, targetRoomName) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom || !targetRoomName) {
        return false;
    }

    var settings = updateRemoteMemory(homeRoom);
    var remoteMemory = settings.rooms[targetRoomName];
    if(!remoteMemory) {
        return false;
    }

    return canUseRemote(homeRoom, targetRoomName, remoteMemory, settings);
}

function isRemoteScoutable(homeRoomName, targetRoomName) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom || !targetRoomName) {
        return false;
    }

    var settings = updateRemoteMemory(homeRoom);
    var remoteMemory = settings.rooms[targetRoomName];
    if(!remoteMemory) {
        return false;
    }

    return canScoutRoom(homeRoom, targetRoomName, remoteMemory, settings);
}

function getHomeExplorationBlockers(room, memory, settings) {
    var blockers = [];

    if(!settings) {
        blockers.push('remote memory missing');
        return blockers;
    }

    if(settings.enabled === false) {
        blockers.push('remote.enabled=false');
    }

    if(!room) {
        blockers.push('home room not visible');
        return blockers;
    }

    if(!room.controller || !room.controller.my) {
        blockers.push('home controller not owned');
    }
    else if(room.controller.level < settings.minHomeRcl) {
        blockers.push('RCL ' + room.controller.level + ' < minHomeRcl ' + settings.minHomeRcl);
    }

    return blockers;
}

function getRemoteExplorationBlockers(room, remoteName, remoteMemory, settings) {
    var blockers = [];

    if(!remoteMemory) {
        blockers.push('remote memory missing');
        return blockers;
    }

    if(remoteMemory.enabled === false) {
        blockers.push('remote disabled');
    }

    var mapAccessible = room ?
        isAccessibleRemoteMapRoom(room.name, remoteName) :
        isAccessibleMapRoom(remoteName);

    if(!mapAccessible) {
        blockers.push('map status ' + getMapRoomStatus(remoteName));
    }

    if(remoteMemory.exitAccessible === false) {
        blockers.push('exit inaccessible');
    }

    if(remoteMemory.distance && remoteMemory.distance > settings.maxRooms) {
        blockers.push('distance ' + remoteMemory.distance + ' > maxRooms ' + settings.maxRooms);
    }

    if(remoteMemory.unsafeUntil && remoteMemory.unsafeUntil > Game.time) {
        blockers.push('unsafe cooldown ' + (remoteMemory.unsafeUntil - Game.time));
    }

    var unsafeRecord = getUnsafeRoomRecord(remoteName);
    if(unsafeRecord) {
        blockers.push('global unsafe cooldown ' + (unsafeRecord.unsafeUntil - Game.time));
    }

    if((remoteMemory.status == 'ready' || remoteMemory.status == 'unknown') &&
        isPersistentRemoteBlockReason(remoteMemory.reason)) {
        blockers.push('remembered ' + remoteMemory.reason);
    }

    if(remoteMemory.status != 'ready' && remoteMemory.status != 'unknown') {
        blockers.push('status ' + (remoteMemory.status || 'unknown') + (remoteMemory.reason ? ': ' + remoteMemory.reason : ''));
    }

    return blockers;
}

function copySharedRemoteMemory(room, remoteName, sourceMemory) {
    var settings = getSettings(room);
    if(!settings.rooms[remoteName]) {
        settings.rooms[remoteName] = {};
    }

    var memory = settings.rooms[remoteName];
    var sourceIsNewer = sourceMemory.lastScouted &&
        (!memory.lastScouted || sourceMemory.lastScouted > memory.lastScouted);

    if(sourceIsNewer || memory.status === undefined || memory.status == 'unknown') {
        var fields = [
            'enabled',
            'status',
            'reason',
            'sourceIds',
            'reservationUsername',
            'reservationTicks',
            'reservationObservedTick',
            'lastScouted',
            'mapStatus',
            'unsafeAttempts',
            'unsafeUntil'
        ];

        for(var i = 0; i < fields.length; i++) {
            var key = fields[i];
            if(sourceMemory[key] === undefined) {
                delete memory[key];
            }
            else if(key == 'sourceIds' && sourceMemory.sourceIds) {
                memory.sourceIds = sourceMemory.sourceIds.slice();
            }
            else {
                memory[key] = sourceMemory[key];
            }
        }
    }

    memory.distance = getRoomLinearDistance(room.name, remoteName);
    return memory;
}

function isClosestSpawnRoomForRemote(room, remoteName) {
    var ownedRooms = getOwnedRooms();
    var bestRoomName = null;
    var bestDistance = 999999;

    for(var i = 0; i < ownedRooms.length; i++) {
        var candidateRoom = ownedRooms[i];
        if(!hasOwnedSpawn(candidateRoom)) {
            continue;
        }

        var settings = getSettings(candidateRoom);
        if(settings.enabled === false ||
            !candidateRoom.controller ||
            candidateRoom.controller.level < settings.minHomeRcl) {
            continue;
        }

        var distance = getRoomLinearDistance(candidateRoom.name, remoteName);
        if(distance > settings.maxRooms) {
            continue;
        }

        if(distance < bestDistance ||
            (distance == bestDistance &&
            (!bestRoomName || candidateRoom.name.localeCompare(bestRoomName) < 0))) {
            bestDistance = distance;
            bestRoomName = candidateRoom.name;
        }
    }

    return !bestRoomName || bestRoomName == room.name;
}

function addRemoteCandidate(room, settings, remoteName, remoteMemory, roomsByName) {
    if(remoteName == room.name || roomsByName[remoteName]) {
        return;
    }

    if(!isClosestSpawnRoomForRemote(room, remoteName)) {
        return;
    }

    var visibleRemote = Game.rooms[remoteName];
    if(visibleRemote &&
        visibleRemote.controller &&
        visibleRemote.controller.my &&
        hasOwnedSpawn(visibleRemote)) {
        return;
    }

    if(canUseRemote(room, remoteName, remoteMemory, settings)) {
        roomsByName[remoteName] = {
            name: remoteName,
            memory: remoteMemory,
            priorityFlag: hasPriorityRemoteFlag(remoteName, settings),
            spawnDistance: getRoomLinearDistance(room.name, remoteName)
        };
    }
}

function getActiveRemoteRooms(room) {
    var settings = getSettings(room);
    var roomsByName = {};

    for(var remoteName in settings.rooms) {
        addRemoteCandidate(room, settings, remoteName, settings.rooms[remoteName], roomsByName);
    }

    var ownedRooms = getOwnedRooms();
    for(var i = 0; i < ownedRooms.length; i++) {
        if(ownedRooms[i].name == room.name) {
            continue;
        }

        var otherSettings = updateRemoteMemory(ownedRooms[i]);
        if(otherSettings.enabled === false || !otherSettings.rooms) {
            continue;
        }

        for(var sharedName in otherSettings.rooms) {
            var sharedMemory = copySharedRemoteMemory(room, sharedName, otherSettings.rooms[sharedName]);
            addRemoteCandidate(room, settings, sharedName, sharedMemory, roomsByName);
        }
    }

    var rooms = [];
    for(var candidateName in roomsByName) {
        rooms.push(roomsByName[candidateName]);
    }

    rooms.sort(function(a, b) {
        if(a.priorityFlag != b.priorityFlag) {
            return a.priorityFlag ? -1 : 1;
        }

        return (a.spawnDistance || a.memory.distance || 1) - (b.spawnDistance || b.memory.distance || 1) ||
            (a.memory.distance || 1) - (b.memory.distance || 1) ||
            a.name.localeCompare(b.name);
    });

    return rooms;
}

function getRoomReportLine(roomName, remoteName, remoteMemory) {
    var status = remoteMemory.status || 'unknown';
    var visible = Game.rooms[remoteName] ? 'visible' : 'unseen';
    var sources = remoteMemory.sourceIds ? remoteMemory.sourceIds.length : '?';
    var distance = remoteMemory.distance === undefined ? '?' : remoteMemory.distance;
    var mapStatus = remoteMemory.mapStatus ? ' map=' + remoteMemory.mapStatus : '';
    var reserve = ' reserve=' +
        (remoteMemory.reservationUsername ? remoteMemory.reservationUsername : 'none') +
        ':' + getEstimatedReservationTicks(remoteMemory);
    var unsafe = remoteMemory.unsafeUntil && remoteMemory.unsafeUntil > Game.time ?
        ' cooldown ' + (remoteMemory.unsafeUntil - Game.time) :
        '';
    var reason = remoteMemory.reason ? ' ' + remoteMemory.reason : '';
    var enabled = remoteMemory.enabled === false ? ' disabled' : '';
    var homeRoom = Game.rooms[roomName];
    var homeMemory = Memory.rooms && Memory.rooms[roomName] ? Memory.rooms[roomName] : null;
    var settings = homeRoom ? getSettings(homeRoom) : (homeMemory ? homeMemory.remote : null);
    var priorityFlag = hasPriorityRemoteFlag(remoteName, settings) ?
        ' priorityFlag=' + (settings.priorityFlagName || DEFAULT_SETTINGS.priorityFlagName) :
        '';
    var blockers = settings ? getRemoteExplorationBlockers(homeRoom, remoteName, remoteMemory, settings) : ['remote memory missing'];
    var decision = blockers.length ? ' blockedBy=' + blockers.join(', ') : ' eligible';

    return roomName + ' -> ' + remoteName +
        ' status=' + status +
        ' ' + visible +
        mapStatus +
        ' dist=' + distance +
        ' sources=' + sources +
        reserve +
        unsafe +
        reason +
        enabled +
        priorityFlag +
        decision;
}

function getReport(homeRoomName, spawnManager) {
    var lines = [];
    var roomNames = [];

    if(homeRoomName) {
        roomNames.push(homeRoomName);
    }
    else {
        for(var roomName in Game.rooms) {
            if(Game.rooms[roomName].controller && Game.rooms[roomName].controller.my) {
                roomNames.push(roomName);
            }
        }
    }

    roomNames.sort();
    for(var i = 0; i < roomNames.length; i++) {
        var room = Game.rooms[roomNames[i]];
        var memory = Memory.rooms && Memory.rooms[roomNames[i]] ? Memory.rooms[roomNames[i]] : null;
        if(!room && !memory) {
            lines.push(roomNames[i] + ' has no visible room or memory');
            continue;
        }

        var settings = room ? updateRemoteMemory(room) : memory.remote;
        if(!settings || !settings.rooms) {
            lines.push(roomNames[i] + ' has no remote discovery memory');
            continue;
        }

        var remoteNames = Object.keys(settings.rooms).sort();
        var homeBlockers = getHomeExplorationBlockers(room, memory, settings);
        lines.push(
            '[' + roomNames[i] + '] remote enabled=' + (settings.enabled !== false) +
                ' maxRooms=' + settings.maxRooms +
                ' minHomeRcl=' + settings.minHomeRcl +
                ' known=' + remoteNames.length +
                (homeBlockers.length ? ' blockedBy=' + homeBlockers.join(', ') : ' eligible')
        );
        lines.push(getRemoteSpawnReportLine(room, settings, spawnManager));

        if(!remoteNames.length) {
            lines.push(roomNames[i] + ' has not discovered adjacent rooms yet');
            continue;
        }

        for(var r = 0; r < remoteNames.length; r++) {
            lines.push(getRoomReportLine(roomNames[i], remoteNames[r], settings.rooms[remoteNames[r]]));
        }
    }

    return lines.join('\n');
}

function countRemoteCreeps(homeRoomName, role, remoteRoomName, sourceId) {
    var count = 0;
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if(creep.memory.role != role ||
            creep.memory.targetRoom != remoteRoomName) {
            continue;
        }

        if(homeRoomName && creep.memory.homeRoom != homeRoomName) {
            continue;
        }

        if(sourceId && creep.memory.sourceId != sourceId) {
            continue;
        }

        count++;
    }

    return count;
}

function getEstimatedReservationTicks(remoteMemory) {
    if(!remoteMemory || !remoteMemory.reservationTicks) {
        return 0;
    }

    var observedTick = remoteMemory.reservationObservedTick || remoteMemory.lastScouted || Game.time;
    return Math.max(0, remoteMemory.reservationTicks - Math.max(0, Game.time - observedTick));
}

function needsRemoteReservation(room, remoteName, remoteMemory, settings) {
    if(!remoteMemory || !settings || !canUseRemote(room, remoteName, remoteMemory, settings)) {
        return false;
    }

    if(remoteMemory.status != 'ready' || !remoteMemory.sourceIds || !remoteMemory.sourceIds.length) {
        return false;
    }

    var username = getMyUsername();
    if(!username) {
        return false;
    }

    if(remoteMemory.reservationUsername && remoteMemory.reservationUsername != username) {
        return false;
    }

    return getEstimatedReservationTicks(remoteMemory) < settings.reserveRenewBelow;
}

function needsRemoteScout(room, remoteName, remoteMemory, settings) {
    if(!remoteMemory || !canScoutRoom(room, remoteName, remoteMemory, settings)) {
        return false;
    }

    return remoteMemory.status == 'unknown' ||
        !remoteMemory.sourceIds ||
        remoteMemory.sourceIds.length === 0;
}

function makeScoutSpawnRequest(homeRoomName, remoteName) {
    return {
        role: 'scout',
        bodyType: 'scout',
        memory: {
            role: 'scout',
            homeRoom: homeRoomName,
            targetRoom: remoteName,
            working: false
        }
    };
}

function makeReserverSpawnRequest(homeRoomName, remoteName) {
    return {
        role: 'reserver',
        bodyType: 'reserver',
        memory: {
            role: 'reserver',
            homeRoom: homeRoomName,
            targetRoom: remoteName,
            working: false
        }
    };
}

function canClaimNewRoom() {
    if(!Game.gcl || typeof Game.gcl.level != 'number') {
        return false;
    }

    var ownedRooms = 0;
    for(var roomName in Game.rooms) {
        var room = Game.rooms[roomName];
        if(room.controller && room.controller.my) {
            ownedRooms++;
        }
    }

    return ownedRooms < Game.gcl.level;
}

function needsRemoteClaim(room, remoteName, remoteMemory, settings) {
    if(!room || !room.controller || room.controller.level < settings.claimMinHomeRcl) {
        return false;
    }

    if(!canClaimNewRoom()) {
        return false;
    }

    if(!remoteMemory || !canUseRemote(room, remoteName, remoteMemory, settings)) {
        return false;
    }

    if(remoteMemory.status != 'ready' || !remoteMemory.sourceIds || !remoteMemory.sourceIds.length) {
        return false;
    }

    var remoteRoom = Game.rooms[remoteName];
    if(!remoteRoom || !remoteRoom.controller) {
        return false;
    }

    if(remoteRoom.controller.my || remoteRoom.controller.owner) {
        return false;
    }

    if(remoteRoom.controller.reservation &&
        remoteRoom.controller.reservation.username != getMyUsername()) {
        return false;
    }

    return true;
}

function makeClaimerSpawnRequest(homeRoomName, remoteName) {
    return {
        role: 'claimer',
        bodyType: 'claimer',
        memory: {
            role: 'claimer',
            homeRoom: homeRoomName,
            targetRoom: remoteName,
            working: false
        }
    };
}

function getClaimerTarget(homeRoomName, currentTargetRoom) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom) {
        return null;
    }

    var settings = updateRemoteMemory(homeRoom);
    if(currentTargetRoom &&
        settings.rooms[currentTargetRoom] &&
        needsRemoteClaim(homeRoom, currentTargetRoom, settings.rooms[currentTargetRoom], settings)) {
        return currentTargetRoom;
    }

    var rooms = getActiveRemoteRooms(homeRoom);
    for(var i = 0; i < rooms.length; i++) {
        if(needsRemoteClaim(homeRoom, rooms[i].name, rooms[i].memory, settings) &&
            countRemoteCreeps(null, 'claimer', rooms[i].name) === 0) {
            return rooms[i].name;
        }
    }

    return null;
}

function getScoutTarget(homeRoomName, currentTargetRoom) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom) {
        return null;
    }

    var settings = updateRemoteMemory(homeRoom);
    if(currentTargetRoom &&
        settings.rooms[currentTargetRoom] &&
        needsRemoteScout(homeRoom, currentTargetRoom, settings.rooms[currentTargetRoom], settings)) {
        return currentTargetRoom;
    }

    var allRooms = [];
    for(var remoteName in settings.rooms) {
        allRooms.push({ name: remoteName, memory: settings.rooms[remoteName] });
    }

    allRooms.sort(function(a, b) {
        return (a.memory.distance || 1) - (b.memory.distance || 1) ||
            a.name.localeCompare(b.name);
    });

    for(var i = 0; i < allRooms.length; i++) {
        if(needsRemoteScout(homeRoom, allRooms[i].name, allRooms[i].memory, settings) &&
            countRemoteCreeps(null, 'scout', allRooms[i].name) === 0) {
            return allRooms[i].name;
        }
    }

    return null;
}

function getReserverTarget(homeRoomName, currentTargetRoom) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!homeRoom) {
        return null;
    }

    var settings = updateRemoteMemory(homeRoom);
    if(currentTargetRoom &&
        settings.rooms[currentTargetRoom] &&
        needsRemoteReservation(homeRoom, currentTargetRoom, settings.rooms[currentTargetRoom], settings)) {
        return currentTargetRoom;
    }

    var rooms = getActiveRemoteRooms(homeRoom);
    for(var i = 0; i < rooms.length; i++) {
        if(needsRemoteReservation(homeRoom, rooms[i].name, rooms[i].memory, settings) &&
            countRemoteCreeps(null, 'reserver', rooms[i].name) === 0) {
            return rooms[i].name;
        }
    }

    return null;
}

function hasSourceContainer(sourceId) {
    if(!sourceId) {
        return false;
    }

    var source = Game.getObjectById(sourceId);
    if(!source) {
        return false;
    }

    return source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_CONTAINER;
        }
    }).length > 0;
}

function countReadyRemoteMinerSources(sourceIds) {
    var readySources = 0;

    for(var i = 0; i < sourceIds.length; i++) {
        if(hasSourceContainer(sourceIds[i])) {
            readySources++;
        }
    }

    return readySources;
}

function makeRemoteSpawnRequest(homeRoomName, remoteName, sourceId) {
    var memory = {
        role: 'remoteMiner',
        homeRoom: homeRoomName,
        targetRoom: remoteName,
        working: false
    };

    if(sourceId) {
        memory.sourceId = sourceId;
    }

    return {
        role: 'remoteMiner',
        bodyType: hasSourceContainer(sourceId) ? 'remoteMiner' : 'remoteStarterMiner',
        memory: memory
    };
}

function makeRemoteHaulerSpawnRequest(homeRoomName, remoteName) {
    return {
        role: 'remoteHauler',
        bodyType: 'remoteHauler',
        memory: {
            role: 'remoteHauler',
            homeRoom: homeRoomName,
            targetRoom: remoteName,
            working: false
        }
    };
}

function hasOwnedSpawn(room) {
    if(!room) {
        return false;
    }

    return room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    }).length > 0;
}

function hasSpawnConstructionSite(room) {
    if(!room) {
        return false;
    }

    return room.find(FIND_CONSTRUCTION_SITES, {
        filter: function(site) {
            return site.structureType == STRUCTURE_SPAWN && site.my !== false;
        }
    }).length > 0;
}

function needsClaimBootstrap(room, remoteName) {
    var remoteRoom = Game.rooms[remoteName];
    if(!room || !remoteRoom || !remoteRoom.controller || !remoteRoom.controller.my) {
        return false;
    }

    return !hasOwnedSpawn(remoteRoom) && hasSpawnConstructionSite(remoteRoom);
}

function makeBootstrapBuilderSpawnRequest(homeRoomName, remoteName) {
    return {
        role: 'builder',
        bodyType: 'builder',
        memory: {
            role: 'builder',
            homeRoom: homeRoomName,
            targetRoom: remoteName,
            working: false
        }
    };
}

function getRemoteEnergyAmount(remoteRoomName) {
    var remoteRoom = Game.rooms[remoteRoomName];
    if(!remoteRoom) {
        return 0;
    }

    var energy = 0;
    var containers = remoteRoom.find(FIND_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_CONTAINER &&
                structure.store &&
                structure.store[RESOURCE_ENERGY] > 0;
        }
    });

    for(var i = 0; i < containers.length; i++) {
        energy += containers[i].store[RESOURCE_ENERGY];
    }

    var dropped = remoteRoom.find(FIND_DROPPED_RESOURCES, {
        filter: function(resource) {
            return resource.resourceType == RESOURCE_ENERGY;
        }
    });

    for(var j = 0; j < dropped.length; j++) {
        energy += dropped[j].amount;
    }

    return energy;
}

function getRemoteSpawnDecision(room, settings) {
    var reasons = [];
    var homeBlockers = getHomeExplorationBlockers(room, room ? room.memory : null, settings);
    if(homeBlockers.length) {
        return {
            request: null,
            reasons: homeBlockers
        };
    }

    for(var scoutRoomName in settings.rooms) {
        var scoutMem = settings.rooms[scoutRoomName];
        if(!canUseRemote(room, scoutRoomName, scoutMem, settings) &&
            needsRemoteScout(room, scoutRoomName, scoutMem, settings) &&
            countRemoteCreeps(null, 'scout', scoutRoomName) === 0) {
            return {
                request: makeScoutSpawnRequest(room.name, scoutRoomName),
                reasons: [],
                detail: scoutRoomName + ': scout re-verification needed after hostile'
            };
        }
    }

    var rooms = getActiveRemoteRooms(room);
    if(!rooms.length) {
        return {
            request: null,
            reasons: ['no active eligible remote rooms']
        };
    }

    for(var i = 0; i < rooms.length; i++) {
        var remote = rooms[i];
        var sourceIds = remote.memory.sourceIds || [];
        var readyMinerSources = countReadyRemoteMinerSources(sourceIds);
        var desiredHaulers = readyMinerSources * REMOTE_HAULERS_PER_MINER;
        var energy = getRemoteEnergyAmount(remote.name);
        var haulers = countRemoteCreeps(null, 'remoteHauler', remote.name);

        if(needsRemoteScout(room, remote.name, remote.memory, settings)) {
            if(countRemoteCreeps(null, 'scout', remote.name) === 0) {
                return {
                    request: makeScoutSpawnRequest(room.name, remote.name),
                    reasons: [],
                    detail: remote.name + ': scout/source discovery needed'
                };
            }

            reasons.push(remote.name + ': scout already assigned');
            continue;
        }

        if(needsClaimBootstrap(room, remote.name)) {
            if(countRemoteCreeps(null, 'builder', remote.name) === 0) {
                return {
                    request: makeBootstrapBuilderSpawnRequest(room.name, remote.name),
                    reasons: [],
                    detail: remote.name + ': bootstrap builder needed for spawn site'
                };
            }

            reasons.push(remote.name + ': bootstrap builder already assigned');
            continue;
        }

        if(desiredHaulers > 0 &&
            energy >= settings.minHaulEnergy &&
            haulers < desiredHaulers) {
            return {
                request: makeRemoteHaulerSpawnRequest(room.name, remote.name),
                reasons: [],
                detail: remote.name + ': haulers ' + haulers + '/' + desiredHaulers +
                    ' for ' + readyMinerSources + ' ready miner source(s)'
            };
        }

        var missingMiner = false;
        for(var sourceIndex = 0; sourceIndex < sourceIds.length; sourceIndex++) {
            if(countRemoteCreeps(null, 'remoteMiner', remote.name, sourceIds[sourceIndex]) === 0) {
                missingMiner = true;
                return {
                    request: makeRemoteSpawnRequest(room.name, remote.name, sourceIds[sourceIndex]),
                    reasons: [],
                    detail: remote.name + ': missing miner for source ' + sourceIds[sourceIndex]
                };
            }
        }

        var roomReasons = [];
        if(!missingMiner) {
            roomReasons.push('all source miners assigned (' + sourceIds.length + ')');
        }

        if(needsRemoteReservation(room, remote.name, remote.memory, settings)) {
            if(countRemoteCreeps(null, 'reserver', remote.name) === 0) {
                return {
                    request: makeReserverSpawnRequest(room.name, remote.name),
                    reasons: [],
                    detail: remote.name + ': reservation ' + getEstimatedReservationTicks(remote.memory) +
                        ' < reserveRenewBelow ' + settings.reserveRenewBelow
                };
            }

            roomReasons.push('reserver already assigned');
        }

        if(needsRemoteClaim(room, remote.name, remote.memory, settings)) {
            if(countRemoteCreeps(null, 'claimer', remote.name) === 0) {
                return {
                    request: makeClaimerSpawnRequest(room.name, remote.name),
                    reasons: [],
                    detail: remote.name + ': claim slot available at GCL ' + Game.gcl.level
                };
            }

            roomReasons.push('claimer already assigned');
        }

        if(desiredHaulers === 0) {
            roomReasons.push('waiting for miner container build');
        }
        else if(energy < settings.minHaulEnergy) {
            roomReasons.push('remote energy ' + energy + ' < minHaulEnergy ' + settings.minHaulEnergy);
        }
        else {
            roomReasons.push('remoteHaulers assigned ' + haulers + '/' + desiredHaulers);
        }

        reasons.push(remote.name + ': ' + roomReasons.join('; '));
    }

    return {
        request: null,
        reasons: reasons.length ? reasons : ['no remote spawn need found']
    };
}

function getSpawnRequest(room) {
    var settings = updateRemoteMemory(room);
    return getRemoteSpawnDecision(room, settings).request;
}

function getSpawnManagerState(room, spawnManager) {
    if(!room ||
        !spawnManager ||
        !spawnManager.countRoles ||
        !spawnManager.getTargets ||
        !spawnManager.getSpawnRole) {
        return null;
    }

    var counts = spawnManager.countRoles(room);
    var targets = spawnManager.getTargets(room, counts);
    var localRole = spawnManager.getSpawnRole(counts, targets);

    return {
        counts: counts,
        targets: targets,
        localRole: localRole
    };
}

function getSpawnAvailabilityBlocker(room) {
    var spawns = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    if(!spawns.length) {
        return 'no owned spawn';
    }

    for(var i = 0; i < spawns.length; i++) {
        if(!spawns[i].spawning) {
            return null;
        }
    }

    return 'all spawns busy';
}

function getRemoteSpawnReportLine(room, settings, spawnManager) {
    if(!room) {
        return 'remote spawn blockedBy=home room not visible';
    }

    var spawnState = getSpawnManagerState(room, spawnManager);
    var spawnBlockers = [];
    var availabilityBlocker = getSpawnAvailabilityBlocker(room);
    if(availabilityBlocker) {
        spawnBlockers.push(availabilityBlocker);
    }

    if(spawnState && spawnState.localRole) {
        spawnBlockers.push(
            'local spawn priority ' +
            spawnState.localRole + ' ' +
            spawnState.counts[spawnState.localRole] + '/' +
            spawnState.targets[spawnState.localRole]
        );
    }

    if(spawnBlockers.length) {
        return 'remote spawn blockedBy=' + spawnBlockers.join(', ');
    }

    var decision = getRemoteSpawnDecision(room, settings);
    if(!decision.request) {
        return 'remote spawn blockedBy=' + decision.reasons.join(', ');
    }

    var line = 'remote spawn next=' + decision.request.role +
        ' -> ' + decision.request.memory.targetRoom;
    if(decision.request.bodyType &&
        decision.request.bodyType != decision.request.role) {
        line += ' body=' + decision.request.bodyType;
    }

    if(decision.request.memory.sourceId) {
        line += ' source=' + decision.request.memory.sourceId;
    }

    if(spawnState &&
        spawnManager &&
        spawnManager.getSpawnBodyDecision) {
        var bodyDecision = spawnManager.getSpawnBodyDecision(
            room,
            decision.request.role,
            decision.request.bodyType,
            spawnState.counts,
            spawnState.targets
        );

        if(bodyDecision.body) {
            line += ' readyEnergy=' + bodyDecision.desiredCost + '/' + room.energyCapacityAvailable;
        }
        else {
            line += ' waitingEnergy=' + room.energyAvailable + '/' + bodyDecision.desiredCost;
        }
    }

    if(decision.detail) {
        line += ' reason=' + decision.detail;
    }

    return line;
}

function findDeliveryTargetInRoom(creep, room, structureTypes) {
    var targets = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structureTypes.indexOf(structure.structureType) >= 0 &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        }
    });

    return getClosestByApproxRange(creep.pos, targets);
}

function findTowerDeliveryTargetInRoom(creep, room) {
    var towers = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_TOWER &&
                (!structure.isActive || structure.isActive()) &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                structure.store[RESOURCE_ENERGY] < Math.min(600, structure.store.getCapacity(RESOURCE_ENERGY));
        }
    });

    return getClosestByApproxRange(creep.pos, towers);
}

function findClosestDeliveryTarget(creep, finder) {
    var rooms = getOwnedRooms();
    var best = null;
    var bestScore = 999999;

    for(var i = 0; i < rooms.length; i++) {
        var target = finder(rooms[i]);
        if(!target) {
            continue;
        }

        var score = getApproxRange(creep.pos, target.pos);
        if(score < bestScore) {
            best = target;
            bestScore = score;
        }
    }

    return best;
}

function findHomeDeliveryTarget(creep) {
    return findClosestDeliveryTarget(creep, function(room) {
        return findDeliveryTargetInRoom(creep, room, [STRUCTURE_SPAWN, STRUCTURE_EXTENSION]);
    }) ||
        findClosestDeliveryTarget(creep, function(room) {
            return findTowerDeliveryTargetInRoom(creep, room);
        }) ||
        findClosestDeliveryTarget(creep, function(room) {
            return findDeliveryTargetInRoom(creep, room, [STRUCTURE_STORAGE, STRUCTURE_TERMINAL]);
        });
}

function getHomeFallback(creep) {
    var homeRoom = Game.rooms[creep.memory.homeRoom];
    if(!homeRoom) {
        return new RoomPosition(25, 25, creep.memory.homeRoom);
    }

    var spawns = homeRoom.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    return spawns[0] || homeRoom.controller || new RoomPosition(25, 25, homeRoom.name);
}

function markUnsafe(homeRoomName, targetRoomName, reason) {
    var homeRoom = Game.rooms[homeRoomName];
    if(!targetRoomName) {
        return;
    }

    var ownedRooms = getOwnedRooms();
    for(var i = 0; i < ownedRooms.length; i++) {
        var settings = getSettings(ownedRooms[i]);
        if(!settings.rooms[targetRoomName]) {
            if(ownedRooms[i].name != homeRoomName) {
                continue;
            }

            settings.rooms[targetRoomName] = {};
        }

        rememberUnsafeRemote(settings, settings.rooms[targetRoomName], targetRoomName, reason);
    }

    if(homeRoom && (!Memory.remote || !Memory.remote.unsafeRooms || !Memory.remote.unsafeRooms[targetRoomName])) {
        var homeSettings = getSettings(homeRoom);
        if(!homeSettings.rooms[targetRoomName]) {
            homeSettings.rooms[targetRoomName] = {};
        }

        var mem = homeSettings.rooms[targetRoomName];
        rememberUnsafeRemote(homeSettings, mem, targetRoomName, reason);
    }
}

function moveHome(creep, intent) {
    var homeFallback = getHomeFallback(creep);
    var homePos = homeFallback.pos || homeFallback;
    creepUtils.moveTo(
        creep,
        homeFallback,
        '#ff66cc',
        intent || 'home',
        'move:' + (intent || 'remoteHome'),
        getRemoteTravelOptions(creep.memory.homeRoom || creep.room.name, homePos.roomName)
    );
    return true;
}

function findRemoteEnergyTarget(creep, homeRoomName, preferredRoomName) {
    var homeRoom = Game.rooms[homeRoomName || creep.memory.homeRoom || creep.room.name];
    if(!homeRoom) {
        return null;
    }

    var settings = getSettings(homeRoom);
    if(settings.enabled === false) {
        return null;
    }

    var rooms = getActiveRemoteRooms(homeRoom);
    if(preferredRoomName) {
        rooms = rooms.filter(function(remote) {
            return remote.name == preferredRoomName;
        });
    }
    var best = null;
    var bestScore = 999999;

    for(var i = 0; i < rooms.length; i++) {
        var remoteRoom = Game.rooms[rooms[i].name];
        if(!remoteRoom ||
            hasThreats(remoteRoom) ||
            hasHostileTower(remoteRoom) ||
            !canHarvestRemoteRoom(remoteRoom)) {
            continue;
        }

        var containers = remoteRoom.find(FIND_STRUCTURES, {
            filter: function(structure) {
                return structure.structureType == STRUCTURE_CONTAINER &&
                    structure.store &&
                    structure.store[RESOURCE_ENERGY] >= Math.min(100, creep.store.getFreeCapacity(RESOURCE_ENERGY));
            }
        });

        for(var c = 0; c < containers.length; c++) {
            var score = getApproxRange(creep.pos, containers[c].pos) - containers[c].store[RESOURCE_ENERGY] / 100;
            if(score < bestScore) {
                best = containers[c];
                bestScore = score;
            }
        }

        var dropped = remoteRoom.find(FIND_DROPPED_RESOURCES, {
            filter: function(resource) {
                return resource.resourceType == RESOURCE_ENERGY &&
                    resource.amount >= Math.min(100, creep.store.getFreeCapacity(RESOURCE_ENERGY));
            }
        });

        for(var d = 0; d < dropped.length; d++) {
            var droppedScore = getApproxRange(creep.pos, dropped[d].pos) - dropped[d].amount / 100;
            if(droppedScore < bestScore) {
                best = dropped[d];
                bestScore = droppedScore;
            }
        }
    }

    return best;
}

function withdrawOrPickup(creep, target) {
    if(!target) {
        return false;
    }

    if(target.resourceType) {
        var pickupResult = creep.pickup(target);
        if(pickupResult == ERR_NOT_IN_RANGE) {
            creepUtils.moveTo(creep, target, '#ffaa00', 'remote haul', 'move:remotePickup');
            return true;
        }

        if(pickupResult == OK) {
            creepUtils.announceIntent(creep, 'action:remotePickup', 'pickup');
            return true;
        }

        return false;
    }

    var withdrawResult = creep.withdraw(target, RESOURCE_ENERGY);
    if(withdrawResult == ERR_NOT_IN_RANGE) {
        creepUtils.moveTo(creep, target, '#ffaa00', 'remote haul', 'move:remoteWithdraw');
        return true;
    }

    if(withdrawResult == OK) {
        creepUtils.announceIntent(creep, 'action:remoteWithdraw', 'haul');
        return true;
    }

    return false;
}

function deliverHome(creep) {
    var target = findHomeDeliveryTarget(creep);
    if(!target) {
        var homeRoom = Game.rooms[creep.memory.homeRoom];
        if(homeRoom && homeRoom.controller) {
            creepUtils.moveTo(creep, homeRoom.controller, '#ffffff', 'home', 'move:remoteHome');
            return true;
        }

        return false;
    }

    return creepUtils.transferEnergy(creep, target);
}

function run(room) {
    updateRemoteMemory(room);
}

module.exports = {
    deliverHome: deliverHome,
    findRemoteEnergyTarget: findRemoteEnergyTarget,
    getClaimerTarget: getClaimerTarget,
    getReserverTarget: getReserverTarget,
    getScoutTarget: getScoutTarget,
    getSettings: getSettings,
    getReport: getReport,
    getSpawnRequest: getSpawnRequest,
    hasHostileTower: hasHostileTower,
    hasThreats: hasThreats,
    isRemoteScoutable: isRemoteScoutable,
    isRemoteUsable: isRemoteUsable,
    canHarvestRemoteRoom: canHarvestRemoteRoom,
    markUnsafe: markUnsafe,
    moveToRoom: moveToRoom,
    moveHome: moveHome,
    run: run,
    withdrawOrPickup: withdrawOrPickup
};
