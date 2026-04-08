const departmentService = require("../../services/department.service");
const supabase = require("../../helpers/supabaseClient");
const cacheService = require("../../services/cache.service");

// Mock dependencies
jest.mock("../../helpers/supabaseClient");
jest.mock("../../services/cache.service");

describe("DepartmentService - getAllDepartments", () => {
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
    it("should return cached departments when cache hit occurs", async () => {
      // Arrange
      const mockCachedDepartments = [
        {
          dept_id: 1,
          dept_name: "Sales",
          dept_is_active: true,
          dept_created_at: "2024-01-01T00:00:00Z",
        },
        {
          dept_id: 2,
          dept_name: "Support",
          dept_is_active: true,
          dept_created_at: "2024-01-02T00:00:00Z",
        },
      ];

      cacheService.getDepartments.mockResolvedValue(mockCachedDepartments);

      // Act
      const result = await departmentService.getAllDepartments();

      // Assert
      expect(result).toEqual(mockCachedDepartments);
      expect(cacheService.getDepartments).toHaveBeenCalledTimes(1);
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("should filter out inactive departments from cached data", async () => {
      // Arrange
      const mockCachedDepartments = [
        {
          dept_id: 1,
          dept_name: "Sales",
          dept_is_active: true,
        },
        {
          dept_id: 2,
          dept_name: "Support",
          dept_is_active: false,
        },
        {
          dept_id: 3,
          dept_name: "Marketing",
          dept_is_active: true,
        },
      ];

      cacheService.getDepartments.mockResolvedValue(mockCachedDepartments);

      // Act
      const result = await departmentService.getAllDepartments();

      // Assert
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { dept_id: 1, dept_name: "Sales", dept_is_active: true },
        { dept_id: 3, dept_name: "Marketing", dept_is_active: true },
      ]);
    });

    it("should return empty array when cache contains empty array", async () => {
      // Arrange
      cacheService.getDepartments.mockResolvedValue([]);

      // Act
      const result = await departmentService.getAllDepartments();

      // Assert
      expect(result).toEqual([]);
      expect(cacheService.getDepartments).toHaveBeenCalledTimes(1);
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  describe("Cache Miss Scenarios", () => {
    it("should fetch from database and cache result when cache miss occurs", async () => {
      // Arrange
      const mockDatabaseDepartments = [
        {
          dept_id: 1,
          dept_name: "Engineering",
          dept_is_active: true,
          dept_created_at: "2024-01-01T00:00:00Z",
        },
        {
          dept_id: 2,
          dept_name: "HR",
          dept_is_active: true,
          dept_created_at: "2024-01-02T00:00:00Z",
        },
      ];

      cacheService.getDepartments.mockResolvedValue(null);
      cacheService.updateDepartments.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockOrder = jest.fn().mockResolvedValue({
        data: mockDatabaseDepartments,
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq,
      });
      mockEq.mockReturnValue({
        order: mockOrder,
      });

      // Act
      const result = await departmentService.getAllDepartments();

      // Assert
      expect(result).toEqual(mockDatabaseDepartments);
      expect(cacheService.getDepartments).toHaveBeenCalledTimes(1);
      expect(supabase.from).toHaveBeenCalledWith("department");
      expect(mockSelect).toHaveBeenCalledWith("*");
      expect(mockEq).toHaveBeenCalledWith("dept_is_active", true);
      expect(mockOrder).toHaveBeenCalledWith("dept_name", { ascending: true });
      expect(cacheService.updateDepartments).toHaveBeenCalledWith(
        mockDatabaseDepartments
      );
    });

    it("should return empty array when database returns no departments", async () => {
      // Arrange
      cacheService.getDepartments.mockResolvedValue(null);
      cacheService.updateDepartments.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockOrder = jest.fn().mockResolvedValue({
        data: [],
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq,
      });
      mockEq.mockReturnValue({
        order: mockOrder,
      });

      // Act
      const result = await departmentService.getAllDepartments();

      // Assert
      expect(result).toEqual([]);
      expect(cacheService.updateDepartments).toHaveBeenCalledWith([]);
    });

    it("should handle null data from database gracefully", async () => {
      // Arrange
      cacheService.getDepartments.mockResolvedValue(null);
      cacheService.updateDepartments.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockOrder = jest.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq,
      });
      mockEq.mockReturnValue({
        order: mockOrder,
      });

      // Act
      const result = await departmentService.getAllDepartments();

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe("Error Handling", () => {
    it("should throw error when database query fails and no cache available", async () => {
      // Arrange
      const mockError = new Error("Database connection failed");
      cacheService.getDepartments.mockResolvedValue(null);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockOrder = jest.fn().mockResolvedValue({
        data: null,
        error: mockError,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq,
      });
      mockEq.mockReturnValue({
        order: mockOrder,
      });

      // Act & Assert
      await expect(departmentService.getAllDepartments()).rejects.toThrow(
        "Database connection failed"
      );
      expect(console.error).toHaveBeenCalled();
    });

    it("should return stale cache data when database fails and cache is available", async () => {
      // Arrange
      const mockStaleCachedData = [
        {
          dept_id: 1,
          dept_name: "Stale Department",
          dept_is_active: true,
        },
      ];
      const mockError = new Error("Database timeout");

      // First call returns null (cache miss), second call returns stale data (fallback)
      cacheService.getDepartments
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockStaleCachedData);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockOrder = jest.fn().mockResolvedValue({
        data: null,
        error: mockError,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq,
      });
      mockEq.mockReturnValue({
        order: mockOrder,
      });

      // Act
      const result = await departmentService.getAllDepartments();

      // Assert
      expect(result).toEqual(mockStaleCachedData);
      expect(cacheService.getDepartments).toHaveBeenCalledTimes(2);
      expect(console.error).toHaveBeenCalledWith(
        "❌ Error in getAllDepartments:",
        mockError.message
      );
      expect(console.log).toHaveBeenCalledWith(
        "⚠️ Returning stale cache data due to database error"
      );
    });

    it("should filter inactive departments from stale cache fallback", async () => {
      // Arrange
      const mockStaleCachedData = [
        { dept_id: 1, dept_name: "Active Dept", dept_is_active: true },
        { dept_id: 2, dept_name: "Inactive Dept", dept_is_active: false },
      ];
      const mockError = new Error("Database error");

      cacheService.getDepartments
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockStaleCachedData);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockOrder = jest.fn().mockResolvedValue({
        data: null,
        error: mockError,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq,
      });
      mockEq.mockReturnValue({
        order: mockOrder,
      });

      // Act
      const result = await departmentService.getAllDepartments();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].dept_name).toBe("Active Dept");
    });

    it("should throw error when both database and cache fallback fail", async () => {
      // Arrange
      const mockDatabaseError = new Error("Database error");
      const mockCacheError = new Error("Cache error");

      cacheService.getDepartments
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(mockCacheError);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockOrder = jest.fn().mockResolvedValue({
        data: null,
        error: mockDatabaseError,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq,
      });
      mockEq.mockReturnValue({
        order: mockOrder,
      });

      // Act & Assert
      await expect(departmentService.getAllDepartments()).rejects.toThrow(
        "Database error"
      );
      expect(console.error).toHaveBeenCalledWith(
        "❌ Cache fallback also failed:",
        mockCacheError.message
      );
    });
  });

  describe("Cache Update Behavior", () => {
    it("should not update cache when database returns null", async () => {
      // Arrange
      cacheService.getDepartments.mockResolvedValue(null);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockOrder = jest.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq,
      });
      mockEq.mockReturnValue({
        order: mockOrder,
      });

      // Act
      await departmentService.getAllDepartments();

      // Assert
      expect(cacheService.updateDepartments).not.toHaveBeenCalled();
    });

    it("should update cache when database returns valid data", async () => {
      // Arrange
      const mockDepartments = [
        { dept_id: 1, dept_name: "Test", dept_is_active: true },
      ];

      cacheService.getDepartments.mockResolvedValue(null);
      cacheService.updateDepartments.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockOrder = jest.fn().mockResolvedValue({
        data: mockDepartments,
        error: null,
      });

      supabase.from.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq,
      });
      mockEq.mockReturnValue({
        order: mockOrder,
      });

      // Act
      await departmentService.getAllDepartments();

      // Assert
      expect(cacheService.updateDepartments).toHaveBeenCalledWith(
        mockDepartments
      );
      expect(cacheService.updateDepartments).toHaveBeenCalledTimes(1);
    });
  });
});
