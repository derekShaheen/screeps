// Count workers as staffed only while a replacement can still arrive in time.
function needsReplacement(creep, homeRoomName, targetRoomName) {
    if(creep.spawning || typeof creep.ticksToLive != 'number') { return false; }
    var spawnTicks = (creep.body ? creep.body.length : 3) *
        (typeof CREEP_SPAWN_TIME == 'number' ? CREEP_SPAWN_TIME : 3);
    var distance = homeRoomName && targetRoomName && homeRoomName != targetRoomName ?
        Game.map.getRoomLinearDistance(homeRoomName, targetRoomName) : 0;
    // Configurable estimate until measured route travel times are available.
    var travelTicks = typeof creep.memory.replacementTravelTicks == 'number' ?
        Math.max(0, creep.memory.replacementTravelTicks) : Math.max(25, distance * 50);
    return creep.ticksToLive <= spawnTicks + travelTicks + 10;
}
module.exports = {needsReplacement: needsReplacement};
