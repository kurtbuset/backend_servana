const chatService = require("../../services/chat.service");
const supabase = require("../../helpers/supabaseClient");
const cacheService = require("../../services/cache.service");

// Mock dependencies
jest.mock("../../helpers/supabaseClient");
jest.mock("../../services/cache.service");

describe("ChatService - getResolvedChatGroupsByUser", () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    // Suppress console logs during tests
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console methods
    console.log.mockRestore();
    console.error.mockRestore();
  });

  describe("Cache Hit Scenarios", () => {
    it("should return cached resolved chat groups when cache hit occurs", async () => {
      // Arrange
      const userId = "user123";
      const mockCachedGroups = [
        {
          chat_group_id: 1,
          dept_id: 10,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Support" },
          client: {
            client_id: 100,
            client_number: "1234567890",
            prof_id: 50,
            profile: {
              prof_firstname: "John",
              prof_lastname: "Doe",
            },
          },
        },
        {
          chat_group_id: 2,
          dept_id: 11,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Sales" },
          client: {
            client_id: 101,
            client_number: "0987654321",
            prof_id: 51,
            profile: {
              prof_firstname: "Jane",
              prof_lastname: "Smith",
            },
          },
        },
      ];

      cacheService.getResolvedUserChatGroups.mockResolvedValue(mockCachedGroups);

      // Act
      const result = await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      expect(result).toEqual(mockCachedGroups);
      expect(cacheService.getResolvedUserChatGroups).toHaveBeenCalledWith(userId);
      expect(cacheService.getResolvedUserChatGroups).toHaveBeenCalledTimes(1);
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("should return empty array from cache when user has no resolved chat groups", async () => {
      // Arrange
      const userId = "user456";
      const mockCachedGroups = [];

      cacheService.getResolvedUserChatGroups.mockResolvedValue(mockCachedGroups);

      // Act
      const result = await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      expect(result).toEqual([]);
      expect(cacheService.getResolvedUserChatGroups).toHaveBeenCalledWith(userId);
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("should handle cached groups with null profile data", async () => {
      // Arrange
      const userId = "user789";
      const mockCachedGroups = [
        {
          chat_group_id: 3,
          dept_id: 12,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Support" },
          client: {
            client_id: 102,
            client_number: "1112223333",
            prof_id: null,
            profile: null,
          },
        },
      ];

      cacheService.getResolvedUserChatGroups.mockResolvedValue(mockCachedGroups);

      // Act
      const result = await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      expect(result).toEqual(mockCachedGroups);
      expect(result[0].client.profile).toBeNull();
      expect(result[0].status).toBe("resolved");
    });

    it("should return cached data without fetching from database", async () => {
      // Arrange
      const userId = "user101";
      const mockCachedGroups = [
        {
          chat_group_id: 4,
          dept_id: 13,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Technical" },
          client: {
            client_id: 103,
            client_number: "4445556666",
            prof_id: 52,
            profile: {
              prof_firstname: "Bob",
              prof_lastname: "Wilson",
            },
          },
        },
      ];

      cacheService.getResolvedUserChatGroups.mockResolvedValue(mockCachedGroups);

      // Act
      const result = await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      expect(result).toEqual(mockCachedGroups);
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  describe("Cache Miss Scenarios", () => {
    it("should fetch from database and cache result when cache miss occurs", async () => {
      // Arrange
      const userId = "user999";
      const mockDatabaseGroups = [
        {
          chat_group_id: 5,
          dept_id: 14,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Customer Service" },
          client: {
            client_id: 104,
            client_number: "7778889999",
            prof_id: 53,
            profile: {
              prof_firstname: "Alice",
              prof_lastname: "Johnson",
            },
          },
        },
      ];

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);
      cacheService.cacheResolvedUserChatGroups.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: mockDatabaseGroups,
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act
      const result = await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      expect(result).toEqual(mockDatabaseGroups);
      expect(cacheService.getResolvedUserChatGroups).toHaveBeenCalledWith(userId);
      expect(supabase.from).toHaveBeenCalledWith("chat_group");
      expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining("chat_group_id"));
      expect(mockEq1).toHaveBeenCalledWith("status", "resolved");
      expect(mockEq2).toHaveBeenCalledWith("sys_user_id", userId);
      expect(cacheService.cacheResolvedUserChatGroups).toHaveBeenCalledWith(
        userId,
        mockDatabaseGroups
      );
    });

    it("should return empty array when database returns no resolved chat groups", async () => {
      // Arrange
      const userId = "user111";

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);
      cacheService.cacheResolvedUserChatGroups.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: [],
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act
      const result = await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      expect(result).toEqual([]);
      expect(cacheService.cacheResolvedUserChatGroups).toHaveBeenCalledWith(userId, []);
    });

    it("should handle null data from database gracefully", async () => {
      // Arrange
      const userId = "user222";

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);
      cacheService.cacheResolvedUserChatGroups.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act
      const result = await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      expect(result).toEqual([]);
      expect(cacheService.cacheResolvedUserChatGroups).toHaveBeenCalledWith(userId, []);
    });

    it("should only fetch resolved status chat groups", async () => {
      // Arrange
      const userId = "user333";
      const mockDatabaseGroups = [
        {
          chat_group_id: 6,
          dept_id: 15,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Support" },
          client: {
            client_id: 105,
            client_number: "1231231234",
            prof_id: 54,
            profile: {
              prof_firstname: "Charlie",
              prof_lastname: "Brown",
            },
          },
        },
      ];

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);
      cacheService.cacheResolvedUserChatGroups.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: mockDatabaseGroups,
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act
      await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      expect(mockEq1).toHaveBeenCalledWith("status", "resolved");
      expect(mockEq2).toHaveBeenCalledWith("sys_user_id", userId);
    });

    it("should fetch with correct select query including nested relations", async () => {
      // Arrange
      const userId = "user444";

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);
      cacheService.cacheResolvedUserChatGroups.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: [],
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act
      await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      const selectCall = mockSelect.mock.calls[0][0];
      expect(selectCall).toContain("chat_group_id");
      expect(selectCall).toContain("dept_id");
      expect(selectCall).toContain("sys_user_id");
      expect(selectCall).toContain("status");
      expect(selectCall).toContain("department:department(dept_name)");
      expect(selectCall).toContain("client:client!chat_group_client_id_fkey");
      expect(selectCall).toContain("profile:profile");
    });
  });

  describe("Error Handling", () => {
    it("should throw error when database query fails", async () => {
      // Arrange
      const userId = "user555";
      const mockError = new Error("Database connection failed");

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: null,
        error: mockError,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act & Assert
      await expect(
        chatService.getResolvedChatGroupsByUser(userId)
      ).rejects.toThrow("Database connection failed");
      expect(console.error).toHaveBeenCalledWith(
        "❌ Error fetching resolved chat groups:",
        mockError.message
      );
    });

    it("should throw error when cache service fails on read", async () => {
      // Arrange
      const userId = "user666";
      const mockCacheError = new Error("Cache service unavailable");

      cacheService.getResolvedUserChatGroups.mockRejectedValue(mockCacheError);

      // Act & Assert
      await expect(
        chatService.getResolvedChatGroupsByUser(userId)
      ).rejects.toThrow("Cache service unavailable");
      expect(console.error).toHaveBeenCalledWith(
        "❌ Error fetching resolved chat groups:",
        mockCacheError.message
      );
    });

    it("should throw error when caching fails after successful database fetch", async () => {
      // Arrange
      const userId = "user777";
      const mockDatabaseGroups = [
        {
          chat_group_id: 7,
          dept_id: 16,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Support" },
          client: {
            client_id: 106,
            client_number: "9998887777",
            prof_id: 55,
            profile: {
              prof_firstname: "Diana",
              prof_lastname: "Prince",
            },
          },
        },
      ];
      const mockCacheError = new Error("Failed to cache data");

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);
      cacheService.cacheResolvedUserChatGroups.mockRejectedValue(mockCacheError);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: mockDatabaseGroups,
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act & Assert
      await expect(
        chatService.getResolvedChatGroupsByUser(userId)
      ).rejects.toThrow("Failed to cache data");
    });

    it("should handle database timeout errors", async () => {
      // Arrange
      const userId = "user888";
      const mockError = new Error("Query timeout exceeded");

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: null,
        error: mockError,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act & Assert
      await expect(
        chatService.getResolvedChatGroupsByUser(userId)
      ).rejects.toThrow("Query timeout exceeded");
    });
  });

  describe("Data Structure Validation", () => {
    it("should return resolved chat groups with complete nested structure", async () => {
      // Arrange
      const userId = "user999";
      const mockDatabaseGroups = [
        {
          chat_group_id: 8,
          dept_id: 17,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Customer Service" },
          client: {
            client_id: 107,
            client_number: "4445556666",
            prof_id: 56,
            profile: {
              prof_firstname: "Eve",
              prof_lastname: "Adams",
            },
          },
        },
      ];

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);
      cacheService.cacheResolvedUserChatGroups.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: mockDatabaseGroups,
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act
      const result = await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      expect(result[0]).toHaveProperty("chat_group_id");
      expect(result[0]).toHaveProperty("dept_id");
      expect(result[0]).toHaveProperty("sys_user_id", userId);
      expect(result[0]).toHaveProperty("status", "resolved");
      expect(result[0]).toHaveProperty("department");
      expect(result[0].department).toHaveProperty("dept_name");
      expect(result[0]).toHaveProperty("client");
      expect(result[0].client).toHaveProperty("client_id");
      expect(result[0].client).toHaveProperty("client_number");
      expect(result[0].client).toHaveProperty("prof_id");
      expect(result[0].client).toHaveProperty("profile");
      expect(result[0].client.profile).toHaveProperty("prof_firstname");
      expect(result[0].client.profile).toHaveProperty("prof_lastname");
    });

    it("should handle multiple resolved chat groups for the same user", async () => {
      // Arrange
      const userId = "user1010";
      const mockDatabaseGroups = [
        {
          chat_group_id: 9,
          dept_id: 18,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Support" },
          client: {
            client_id: 108,
            client_number: "1111111111",
            prof_id: 57,
            profile: {
              prof_firstname: "Frank",
              prof_lastname: "Miller",
            },
          },
        },
        {
          chat_group_id: 10,
          dept_id: 19,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Sales" },
          client: {
            client_id: 109,
            client_number: "2222222222",
            prof_id: 58,
            profile: {
              prof_firstname: "Grace",
              prof_lastname: "Hopper",
            },
          },
        },
        {
          chat_group_id: 11,
          dept_id: 20,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Technical" },
          client: {
            client_id: 110,
            client_number: "3333333333",
            prof_id: 59,
            profile: {
              prof_firstname: "Henry",
              prof_lastname: "Ford",
            },
          },
        },
      ];

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);
      cacheService.cacheResolvedUserChatGroups.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: mockDatabaseGroups,
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act
      const result = await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0].chat_group_id).toBe(9);
      expect(result[1].chat_group_id).toBe(10);
      expect(result[2].chat_group_id).toBe(11);
      expect(result.every(group => group.status === "resolved")).toBe(true);
    });

    it("should ensure all returned groups have resolved status", async () => {
      // Arrange
      const userId = "user1111";
      const mockDatabaseGroups = [
        {
          chat_group_id: 12,
          dept_id: 21,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Support" },
          client: {
            client_id: 111,
            client_number: "4444444444",
            prof_id: 60,
            profile: {
              prof_firstname: "Ivy",
              prof_lastname: "Lee",
            },
          },
        },
      ];

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);
      cacheService.cacheResolvedUserChatGroups.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: mockDatabaseGroups,
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act
      const result = await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      result.forEach(group => {
        expect(group.status).toBe("resolved");
      });
    });
  });

  describe("Cache Behavior", () => {
    it("should cache the fetched resolved data with correct parameters", async () => {
      // Arrange
      const userId = "user1212";
      const mockDatabaseGroups = [
        {
          chat_group_id: 13,
          dept_id: 22,
          sys_user_id: userId,
          status: "resolved",
          department: { dept_name: "Support" },
          client: {
            client_id: 112,
            client_number: "5555555555",
            prof_id: 61,
            profile: {
              prof_firstname: "Jack",
              prof_lastname: "Ryan",
            },
          },
        },
      ];

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);
      cacheService.cacheResolvedUserChatGroups.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: mockDatabaseGroups,
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act
      await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      expect(cacheService.cacheResolvedUserChatGroups).toHaveBeenCalledWith(
        userId,
        mockDatabaseGroups
      );
      expect(cacheService.cacheResolvedUserChatGroups).toHaveBeenCalledTimes(1);
    });

    it("should cache empty array when no resolved groups found", async () => {
      // Arrange
      const userId = "user1313";

      cacheService.getResolvedUserChatGroups.mockResolvedValue(null);
      cacheService.cacheResolvedUserChatGroups.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq1 = jest.fn().mockReturnThis();
      const mockEq2 = jest.fn().mockResolvedValue({
        data: [],
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq1,
      });
      mockEq1.mockReturnValue({
        eq: mockEq2,
      });

      // Act
      await chatService.getResolvedChatGroupsByUser(userId);

      // Assert
      expect(cacheService.cacheResolvedUserChatGroups).toHaveBeenCalledWith(userId, []);
    });
  });
});
