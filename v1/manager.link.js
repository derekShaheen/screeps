var debug = require('utils.debug');

function formatPos(pos) {
    return pos.roomName + ':' + pos.x + ',' + pos.y;
}

function getLinks(room) {
    return room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_LINK;
        }
    });
}

function classifyLink(room, link) {
    if(link.pos.findInRange(FIND_SOURCES, 2).length > 0) {
        return 'source';
    }

    if(room.controller && link.pos.getRangeTo(room.controller) <= 4) {
        return 'controller';
    }

    if(room.storage && link.pos.getRangeTo(room.storage) <= 3) {
        return 'storage';
    }

    var spawns = room.find(FIND_MY_STRUCTURES, {
        filter: function(structure) {
            return structure.structureType == STRUCTURE_SPAWN;
        }
    });

    for(var i = 0; i < spawns.length; i++) {
        if(link.pos.getRangeTo(spawns[i]) <= 4) {
            return 'base';
        }
    }

    return 'relay';
}

function updateLinkRoles(room, links) {
    var roles = {};
    for(var i = 0; i < links.length; i++) {
        roles[links[i].id] = classifyLink(room, links[i]);
    }

    room.memory.linkRoles = roles;
    return roles;
}

function getFreeEnergyCapacity(link) {
    return link.store.getFreeCapacity(RESOURCE_ENERGY);
}

function getBestReceiver(links, roles, preferredRole) {
    var best = null;
    for(var i = 0; i < links.length; i++) {
        if(roles[links[i].id] != preferredRole ||
            getFreeEnergyCapacity(links[i]) <= 0) {
            continue;
        }

        if(!best || links[i].store[RESOURCE_ENERGY] < best.store[RESOURCE_ENERGY]) {
            best = links[i];
        }
    }

    return best;
}

function transferLinkEnergy(source, target, label) {
    if(!source ||
        !target ||
        source.id == target.id ||
        source.cooldown > 0 ||
        source.store[RESOURCE_ENERGY] < 100 ||
        getFreeEnergyCapacity(target) <= 0) {
        return false;
    }

    var result = source.transferEnergy(target);
    if(result == OK) {
        debug.log(
            'debugRoles',
            'link ' + label + ' ' + formatPos(source.pos) + ' -> ' + formatPos(target.pos),
            3
        );
        return true;
    }

    debug.log('debugRoles', 'link transfer failed ' + label + ': ' + result, 10);
    return false;
}

function runSourceLinks(links, roles) {
    var controllerLink = getBestReceiver(links, roles, 'controller');
    var storageLink = getBestReceiver(links, roles, 'storage') || getBestReceiver(links, roles, 'base');

    for(var i = 0; i < links.length; i++) {
        if(roles[links[i].id] != 'source') {
            continue;
        }

        if(transferLinkEnergy(links[i], controllerLink, 'source-controller')) {
            continue;
        }

        transferLinkEnergy(links[i], storageLink, 'source-base');
    }
}

function runBaseLinks(links, roles) {
    var controllerLink = getBestReceiver(links, roles, 'controller');
    if(!controllerLink || controllerLink.store[RESOURCE_ENERGY] > 400) {
        return;
    }

    for(var i = 0; i < links.length; i++) {
        var role = roles[links[i].id];
        if(role != 'storage' && role != 'base' && role != 'relay') {
            continue;
        }

        if(transferLinkEnergy(links[i], controllerLink, 'base-controller')) {
            return;
        }
    }
}

var linkManager = {
    run: function(room) {
        if(!room.controller || !room.controller.my) {
            return;
        }

        var links = getLinks(room);
        if(!links.length) {
            delete room.memory.linkRoles;
            return;
        }

        var roles = updateLinkRoles(room, links);
        runSourceLinks(links, roles);
        runBaseLinks(links, roles);
    }
};

module.exports = linkManager;
