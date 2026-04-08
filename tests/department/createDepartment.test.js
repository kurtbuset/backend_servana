const departmentService = require("../../services/department.service");
const supabase = require("../../helpers/supabaseClient");
const cacheService = require("../../services/cache.service");

// Mock dependencies
jest.mock("../../helpers/supabaseClient");
jest.mock("../../services/cache.service");

describe("DepartmentService - createDepartment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
  });

  describe("Successful Creation", () => {
    it("should create a new department and invalidate cache", async () => {
      // Arrange
      const deptName = "New Department";
      const createdBy = "user123";
      const mockCreatedDepartment = {
        dept_id: 1,
        dept_name: deptName,
        dept_created_by: createdBy,
        dept_updated_by: createdBy,
        dept_is_active: true,
        dept_created_at: "2024-01-01T00:00:00Z",
        dept_updated_at: "2024-01-01T00:00:00Z",
      };

      cacheService.invalidateDepartments.mockResolvedValue(true);
      
      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: mockCreatedDepartment,
        error: null,
      });
      const mockInsert = jest.fn().mockReturnValue({
        select: mockSelect,
      });

      supabase.from.mockReturnValue({
        insert: mockInsert,
      });
      mockSelect.mockReturnValue({
        single: mockSingle,
      });

      // Mock invalidateDepartmentMembersCache
      jest.spyOn(departmentService, "invalidateDepartmentMembersCache").mockResolvedValue();

      // Act
      const result = await departmentService.createDepartment(deptName, createdBy);

      // Assert
      expect(result).toEqual(mockCreatedDepartment);
      expect(supabase.from).toHaveBeenCalledWith("department");
      expect(mockInsert).toHaveBeenCalledWith([
        {
          dept_name: deptName,
          dept_created_by: createdBy,
          dept_updated_by: createdBy,
        },
      ]);
      expect(mockSelect).toHaveBeenCalled();
      expect(mockSingle).toHaveBeenCalled();
      expect(cacheService.invalidateDepartments).toHaveBeenCalledTimes(1);
      expect(departmentService.invalidateDepartmentMembersCache).toHaveBeenCalledTimes(1);
      expect(console.log).toHaveBeenCalledWith(
        "🧹 Invalidated departments cache after creation"
      );
    });

    it("should handle department creation with special characters in name", async () => {
      // Arrange
      const deptName = "Sales & Marketing";
      const createdBy = "admin456";
      const mockCreatedDepartment = {
        dept_id: 2,
        dept_name: deptName,
        dept_created_by: createdBy,
        dept_updated_by: createdBy,
        dept_is_active: true,
      };

      cacheService.invalidateDepartments.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: mockCreatedDepartment,
        error: null,
      });
      const mockInsert = jest.fn().mockReturnValue({
        select: mockSelect,
      });

      supabase.from.mockReturnValue({
        insert: mockInsert,
      });
      mockSelect.mockReturnValue({
        single: mockSingle,
      });

      jest.spyOn(departmentService, "invalidateDepartmentMembersCache").mockResolvedValue();

      // Act
      const result = await departmentService.createDepartment(deptName, createdBy);

      // Assert
      expect(result).toEqual(mockCreatedDepartment);
      expect(mockInsert).toHaveBeenCalledWith([
        {
          dept_name: deptName,
          dept_created_by: createdBy,
          dept_updated_by: createdBy,
        },
      ]);
    });
  });

  describe("Error Handling", () => {
    it("should throw error when database insert fails", async () => {
      // Arrange
      const deptName = "Failed Department";
      const createdBy = "user789";
      const mockError = new Error("Duplicate department name");

      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: mockError,
      });
      const mockInsert = jest.fn().mockReturnValue({
        select: mockSelect,
      });

      supabase.from.mockReturnValue({
        insert: mockInsert,
      });
      mockSelect.mockReturnValue({
        single: mockSingle,
      });

      // Act & Assert
      await expect(
        departmentService.createDepartment(deptName, createdBy)
      ).rejects.toThrow("Duplicate department name");
      expect(console.error).toHaveBeenCalledWith(
        "❌ Error in createDepartment:",
        mockError.message
      );
      expect(cacheService.invalidateDepartments).not.toHaveBeenCalled();
    });

    it("should throw error when cache invalidation fails but department is created", async () => {
      // Arrange
      const deptName = "Test Department";
      const createdBy = "user999";
      const mockCreatedDepartment = {
        dept_id: 3,
        dept_name: deptName,
        dept_created_by: createdBy,
        dept_updated_by: createdBy,
      };
      const mockCacheError = new Error("Cache invalidation failed");

      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: mockCreatedDepartment,
        error: null,
      });
      const mockInsert = jest.fn().mockReturnValue({
        select: mockSelect,
      });

      supabase.from.mockReturnValue({
        insert: mockInsert,
      });
      mockSelect.mockReturnValue({
        single: mockSingle,
      });

      cacheService.invalidateDepartments.mockRejectedValue(mockCacheError);

      // Act & Assert
      await expect(
        departmentService.createDepartment(deptName, createdBy)
      ).rejects.toThrow("Cache invalidation failed");
    });

    it("should handle null or undefined department name", async () => {
      // Arrange
      const deptName = null;
      const createdBy = "user111";
      const mockError = new Error("Department name cannot be null");

      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: mockError,
      });
      const mockInsert = jest.fn().mockReturnValue({
        select: mockSelect,
      });

      supabase.from.mockReturnValue({
        insert: mockInsert,
      });
      mockSelect.mockReturnValue({
        single: mockSingle,
      });

      // Act & Assert
      await expect(
        departmentService.createDepartment(deptName, createdBy)
      ).rejects.toThrow("Department name cannot be null");
    });

    it("should handle empty string department name", async () => {
      // Arrange
      const deptName = "";
      const createdBy = "user222";
      const mockError = new Error("Department name cannot be empty");

      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: mockError,
      });
      const mockInsert = jest.fn().mockReturnValue({
        select: mockSelect,
      });

      supabase.from.mockReturnValue({
        insert: mockInsert,
      });
      mockSelect.mockReturnValue({
        single: mockSingle,
      });

      // Act & Assert
      await expect(
        departmentService.createDepartment(deptName, createdBy)
      ).rejects.toThrow("Department name cannot be empty");
    });
  });

  describe("Cache Invalidation", () => {
    it("should invalidate both departments and department members cache", async () => {
      // Arrange
      const deptName = "Cache Test Department";
      const createdBy = "user333";
      const mockCreatedDepartment = {
        dept_id: 4,
        dept_name: deptName,
        dept_created_by: createdBy,
        dept_updated_by: createdBy,
      };

      cacheService.invalidateDepartments.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: mockCreatedDepartment,
        error: null,
      });
      const mockInsert = jest.fn().mockReturnValue({
        select: mockSelect,
      });

      supabase.from.mockReturnValue({
        insert: mockInsert,
      });
      mockSelect.mockReturnValue({
        single: mockSingle,
      });

      const invalidateMembersCacheSpy = jest
        .spyOn(departmentService, "invalidateDepartmentMembersCache")
        .mockResolvedValue();

      // Act
      await departmentService.createDepartment(deptName, createdBy);

      // Assert
      expect(cacheService.invalidateDepartments).toHaveBeenCalledTimes(1);
      expect(invalidateMembersCacheSpy).toHaveBeenCalledTimes(1);
    });

    it("should log cache invalidation message", async () => {
      // Arrange
      const deptName = "Log Test Department";
      const createdBy = "user444";
      const mockCreatedDepartment = {
        dept_id: 5,
        dept_name: deptName,
        dept_created_by: createdBy,
        dept_updated_by: createdBy,
      };

      cacheService.invalidateDepartments.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: mockCreatedDepartment,
        error: null,
      });
      const mockInsert = jest.fn().mockReturnValue({
        select: mockSelect,
      });

      supabase.from.mockReturnValue({
        insert: mockInsert,
      });
      mockSelect.mockReturnValue({
        single: mockSingle,
      });

      jest.spyOn(departmentService, "invalidateDepartmentMembersCache").mockResolvedValue();

      // Act
      await departmentService.createDepartment(deptName, createdBy);

      // Assert
      expect(console.log).toHaveBeenCalledWith(
        "🧹 Invalidated departments cache after creation"
      );
    });
  });

  describe("Data Integrity", () => {
    it("should set both created_by and updated_by to the same user", async () => {
      // Arrange
      const deptName = "Integrity Test";
      const createdBy = "user555";
      const mockCreatedDepartment = {
        dept_id: 6,
        dept_name: deptName,
        dept_created_by: createdBy,
        dept_updated_by: createdBy,
      };

      cacheService.invalidateDepartments.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: mockCreatedDepartment,
        error: null,
      });
      const mockInsert = jest.fn().mockReturnValue({
        select: mockSelect,
      });

      supabase.from.mockReturnValue({
        insert: mockInsert,
      });
      mockSelect.mockReturnValue({
        single: mockSingle,
      });

      jest.spyOn(departmentService, "invalidateDepartmentMembersCache").mockResolvedValue();

      // Act
      await departmentService.createDepartment(deptName, createdBy);

      // Assert
      expect(mockInsert).toHaveBeenCalledWith([
        {
          dept_name: deptName,
          dept_created_by: createdBy,
          dept_updated_by: createdBy,
        },
      ]);
    });

    it("should return the created department with all fields", async () => {
      // Arrange
      const deptName = "Complete Department";
      const createdBy = "user666";
      const mockCreatedDepartment = {
        dept_id: 7,
        dept_name: deptName,
        dept_created_by: createdBy,
        dept_updated_by: createdBy,
        dept_is_active: true,
        dept_created_at: "2024-01-01T00:00:00Z",
        dept_updated_at: "2024-01-01T00:00:00Z",
      };

      cacheService.invalidateDepartments.mockResolvedValue(true);

      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: mockCreatedDepartment,
        error: null,
      });
      const mockInsert = jest.fn().mockReturnValue({
        select: mockSelect,
      });

      supabase.from.mockReturnValue({
        insert: mockInsert,
      });
      mockSelect.mockReturnValue({
        single: mockSingle,
      });

      jest.spyOn(departmentService, "invalidateDepartmentMembersCache").mockResolvedValue();

      // Act
      const result = await departmentService.createDepartment(deptName, createdBy);

      // Assert
      expect(result).toHaveProperty("dept_id");
      expect(result).toHaveProperty("dept_name", deptName);
      expect(result).toHaveProperty("dept_created_by", createdBy);
      expect(result).toHaveProperty("dept_updated_by", createdBy);
      expect(result).toHaveProperty("dept_is_active");
      expect(result).toHaveProperty("dept_created_at");
      expect(result).toHaveProperty("dept_updated_at");
    });
  });
});
