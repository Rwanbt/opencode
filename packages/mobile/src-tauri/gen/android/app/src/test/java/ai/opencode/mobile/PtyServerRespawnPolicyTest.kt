package ai.opencode.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PtyServerRespawnPolicyTest {

    @Test
    fun `expected exit never respawns and resets the attempt count`() {
        val policy = PtyServerRespawnPolicy(maxAttempts = 3)
        assertFalse(policy.shouldRespawn(expected = true))
        assertEquals(0, policy.attemptCount())
    }

    @Test
    fun `unexpected exit respawns and counts the attempt`() {
        val policy = PtyServerRespawnPolicy(maxAttempts = 3)
        assertTrue(policy.shouldRespawn(expected = false))
        assertEquals(1, policy.attemptCount())
    }

    @Test
    fun `stops respawning once maxAttempts is reached, never crash-looping forever`() {
        val policy = PtyServerRespawnPolicy(maxAttempts = 3)
        assertTrue(policy.shouldRespawn(expected = false))
        assertTrue(policy.shouldRespawn(expected = false))
        assertTrue(policy.shouldRespawn(expected = false))
        // 4th consecutive unexpected death: budget exhausted, give up.
        assertFalse(policy.shouldRespawn(expected = false))
        assertEquals(3, policy.attemptCount())
    }

    @Test
    fun `onHealthy resets the attempt count so a later crash gets a fresh budget`() {
        val policy = PtyServerRespawnPolicy(maxAttempts = 2)
        assertTrue(policy.shouldRespawn(expected = false))
        assertTrue(policy.shouldRespawn(expected = false))
        assertFalse(policy.shouldRespawn(expected = false))

        policy.onHealthy()

        assertEquals(0, policy.attemptCount())
        assertTrue(policy.shouldRespawn(expected = false))
    }

    @Test
    fun `an expected stop mid-crash-loop also resets the budget`() {
        val policy = PtyServerRespawnPolicy(maxAttempts = 2)
        assertTrue(policy.shouldRespawn(expected = false))

        assertFalse(policy.shouldRespawn(expected = true))
        assertEquals(0, policy.attemptCount())

        assertTrue(policy.shouldRespawn(expected = false))
        assertEquals(1, policy.attemptCount())
    }
}
