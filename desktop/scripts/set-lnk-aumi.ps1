$cs = @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace LnkAumi {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PROPERTYKEY {
    public Guid fmtid;
    public uint pid;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PROPVARIANT {
    public ushort vt;
    public ushort r1, r2, r3;
    public IntPtr p;
    public int p2a;
    public int p2b;
  }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    void GetCount(out uint cProps);
    void GetAt(uint iProp, out PROPERTYKEY pkey);
    void GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
    void SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
    void Commit();
  }

  [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszFile, int cchMaxPath, IntPtr pfd, uint fFlags);
    void GetIDList(out IntPtr ppidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder p, int c);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder p, int c);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder p, int c);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string p);
    void GetHotkey(out ushort h);
    void SetHotkey(ushort h);
    void GetShowCmd(out int s);
    void SetShowCmd(int s);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder p, int c, out int piIcon);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string p, int iIcon);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string p, uint dwReserved);
    void Resolve(IntPtr hwnd, uint fFlags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string p);
  }

  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  public class CShellLink {}

  public static class Lnk {
    public static void SetAumi(string lnkPath, string aumi) {
      var link = (IShellLinkW)new CShellLink();
      var pf = (IPersistFile)link;
      pf.Load(lnkPath, 2);  // STGM_READWRITE = 2

      var store = (IPropertyStore)link;
      var pkey = new PROPERTYKEY {
        fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
        pid = 5
      };

      var pv = new PROPVARIANT { vt = 31 };  // VT_LPWSTR
      pv.p = Marshal.StringToCoTaskMemUni(aumi);
      store.SetValue(ref pkey, ref pv);
      store.Commit();
      Marshal.FreeCoTaskMem(pv.p);

      pf.Save(lnkPath, true);
      Marshal.ReleaseComObject(store);
      Marshal.ReleaseComObject(pf);
      Marshal.ReleaseComObject(link);
    }

    public static string GetAumi(string lnkPath) {
      var link = (IShellLinkW)new CShellLink();
      var pf = (IPersistFile)link;
      pf.Load(lnkPath, 0);

      var store = (IPropertyStore)link;
      var pkey = new PROPERTYKEY {
        fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
        pid = 5
      };
      PROPVARIANT pv;
      store.GetValue(ref pkey, out pv);
      string result = (pv.vt == 31) ? Marshal.PtrToStringUni(pv.p) : (pv.vt == 0 ? "<empty>" : ("vt=" + pv.vt));
      Marshal.ReleaseComObject(store);
      Marshal.ReleaseComObject(pf);
      Marshal.ReleaseComObject(link);
      return result;
    }
  }
}
'@
Add-Type -TypeDefinition $cs -Language CSharp

$lnk = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\翻译工具.lnk"
"Before: $([LnkAumi.Lnk]::GetAumi($lnk))"
[LnkAumi.Lnk]::SetAumi($lnk, "com.internal.translator-tool")
"After: $([LnkAumi.Lnk]::GetAumi($lnk))"
