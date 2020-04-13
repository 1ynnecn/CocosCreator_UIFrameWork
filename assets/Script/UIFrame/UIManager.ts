import BaseUIForm from "./BaseUIForm";
import { SysDefine, UIFormType, UIFormShowMode } from "./config/SysDefine";
import UIIndependentManager from "./UIIndependentManager";
import UILoader from "./UILoader";

const {ccclass, property} = cc._decorator;

@ccclass
export default class UIManager extends cc.Component {
    
    private _NoNormal: cc.Node = null;                              // 全屏显示的UI 挂载结点
    private _NoFixed: cc.Node = null;                               // 固定显示的UI
    private _NoPopUp: cc.Node = null;                               // 弹出窗口
    private _NoIndependent: cc.Node = null;                         // 独立窗体
    private _NoTips: cc.Node = null;                                // 提示信息
    

    private _StaCurrentUIForms:Array<BaseUIForm> = [];                     // 存储反向切换的窗体
    private _MapAllUIForms: {[key: string]: BaseUIForm} = cc.js.createMap();              // 所有的窗体
    private _MapCurrentShowUIForms: {[key: string]: BaseUIForm} = cc.js.createMap();      // 正在显示的窗体(不包括弹窗)
    private _MapIndependentForms: {[key: string]: BaseUIForm} = cc.js.createMap();        // 独立窗体 独立于其他窗体, 不受其他窗体的影响

    private _LoadingForm: {[key: string]: boolean} = cc.js.createMap();                     // 正在加载的form 

    private static _Instance: UIManager = null;                     // 单例
    public static getInstance(): UIManager {
        if(this._Instance == null) {
            this._Instance = cc.find(SysDefine.SYS_UIROOT_NAME).addComponent<UIManager>(this);
            cc.director.once(cc.Director.EVENT_AFTER_SCENE_LAUNCH, () => {
                this._Instance = null;
            });
        }
        return this._Instance;
    }

    onLoad () {
        // 初始化结点
        this._NoNormal = this.node.getChildByName(SysDefine.SYS_NORMAL_NODE);
        this._NoFixed = this.node.getChildByName(SysDefine.SYS_FIXED_NODE);
        this._NoPopUp = this.node.getChildByName(SysDefine.SYS_POPUP_NODE);
        this._NoIndependent = this.node.getChildByName(SysDefine.SYS_INDEPENDENT_NODE);
        this._NoTips = this.node.getChildByName(SysDefine.SYS_TIPS_NODE);
    }
    
    start() {        
    }

    public addTips(tips: cc.Node, index?: number) {
        this._NoTips.addChild(tips, index);
    }

    /** 预加载加载UIForm */
    public async loadUIForms(formName: string | Array<string>) {
        if(typeof(formName) === 'string') {
            await this.loadFormsToAllUIFormsCatch(formName);
        }else {
            for(const name of formName) {
                await this.loadFormsToAllUIFormsCatch(name);
            }
        }
    }
    
    /** 加载Form时显示等待页面 */
    public async showUIFormWithLoading(uiFormName: string, waitFormName?: string) {
        await UIIndependentManager.getInstance().showLoadingForm();
        await UIManager.getInstance().showUIForm(uiFormName);
    }

    /**
     * 窗体是否正在显示
     * @param uiFormName 
     */
    public checkUIFormIsShowing(uiFormName: string) {
        let baseUIForms = this._MapAllUIForms[uiFormName];
        if (baseUIForms == null) {
            return false;
        }
        return baseUIForms.node.active;
    }

    /**
     * 重要方法 加载显示一个UIForm
     * @param uiFormName 
     * @param obj 初始化信息, 可以不要
     */
    public async showUIForm(uiFormName: string, obj?: any) {
        if(uiFormName === "" || uiFormName == null) return ;
        if(this.checkUIFormIsShowing(uiFormName)) {
            cc.log(`${uiFormName}窗体已经在显示`);
            return ;        
        }
        
        let baseUIForms = await this.loadFormsToAllUIFormsCatch(uiFormName);
        if(baseUIForms == null) {
            cc.log(`${uiFormName}可能正在加载中`);
            return ;
        }

        // 初始化窗体名称
        baseUIForms.UIFormName = uiFormName;
        
        // 是否清理栈内窗口
        if(baseUIForms.UIType.IsClearStack) {
            this.clearStackArray();
        }
        
        switch(baseUIForms.UIType.UIForms_ShowMode) {
            case UIFormShowMode.Normal:                             // 普通模式显示
                this.loadUIToCurrentCache(uiFormName, obj);
            break;
            case UIFormShowMode.ReverseChange:                      // 反向切换
                this.pushUIFormToStack(uiFormName, obj);
            break;
            case UIFormShowMode.HideOther:                          // 隐藏其他
                this.enterUIFormsAndHideOther(uiFormName, obj);
            break;
            case UIFormShowMode.Independent:                        // 独立显示
                this.loadUIFormsToIndependent(uiFormName, obj);
            break;
        }

        return baseUIForms;
    }
    /**
     * 重要方法 关闭一个UIForm
     * @param uiFormName 
     */
    public closeUIForm(uiFormName: string) {
        if(uiFormName == "" || uiFormName == null) return ;
        let baseUIForm = this._MapAllUIForms[uiFormName];
        
        if(baseUIForm == null) return ;
        
        switch(baseUIForm.UIType.UIForms_ShowMode) {
            case UIFormShowMode.Normal:                             // 普通模式显示
                this.exitUIForms(uiFormName);
            break;
            case UIFormShowMode.ReverseChange:                      // 反向切换
                this.popUIForm();
            break;
            case UIFormShowMode.HideOther:                          // 隐藏其他
                this.exitUIFormsAndDisplayOther(uiFormName);
            break;
            case UIFormShowMode.Independent:
                this.exitIndependentForms(uiFormName);
            break;
        }
        // 判断是否销毁该窗体
        if(baseUIForm.CloseAndDestory) {
            this.destoryForm(baseUIForm, uiFormName);
        }
    }


    /**
     * 从全部的UI窗口中加载, 并挂载到结点上
     */
    private async loadFormsToAllUIFormsCatch(uiFormName: string) {
        let baseUIResult = this._MapAllUIForms[uiFormName];
        // 判断窗体不在mapAllUIForms中， 也不再loadingForms中
        if (baseUIResult == null && !this._LoadingForm[uiFormName]) {
            //加载指定名称的“UI窗体
            this._LoadingForm[uiFormName] = true;
            baseUIResult  = await this.loadUIForm(uiFormName) as BaseUIForm;
            this._LoadingForm[uiFormName] = false;
            delete this._LoadingForm[uiFormName];
        }
        return baseUIResult;
    }

    /**
     * 从resources中加载
     * @param uiFormName 
     */
    private async loadUIForm(strUIFormPath: string) {
        if(strUIFormPath == "" || strUIFormPath == null){
            return ;
        }
        
        let pre = await UILoader.getInstance().loadForm(strUIFormPath);
        let node: cc.Node = cc.instantiate(pre);
        let baseUIForm = node.getComponent(BaseUIForm);
        if(baseUIForm == null) {
            return ;
        }
        node.active = false;
        switch(baseUIForm.UIType.UIForms_Type) {
            case UIFormType.Normal:
                UIManager.getInstance()._NoNormal.addChild(node);
            break;
            case UIFormType.Fixed:
                UIManager.getInstance()._NoFixed.addChild(node);
            break;
            case UIFormType.PopUp:
                UIManager.getInstance()._NoPopUp.addChild(node);
            break;
            case UIFormType.Independent:
                UIManager.getInstance()._NoIndependent.addChild(node);
            break;
        }
        this._MapAllUIForms[strUIFormPath] = baseUIForm;
        
        return baseUIForm;
    }

    /**
     * 清除栈内所有窗口
     */
    private clearStackArray() {
        if(this._StaCurrentUIForms != null && this._StaCurrentUIForms.length >= 1) {
            this._StaCurrentUIForms = [];
            return true;
        }
        return false;
    }
    /**
     * 关闭栈顶窗口
     */
    public closeStackTopUIForm() {
        if(this._StaCurrentUIForms != null && this._StaCurrentUIForms.length >= 1) {
            let uiFrom = this._StaCurrentUIForms[this._StaCurrentUIForms.length-1];
            if(uiFrom.MaskType.ClickMaskClose) {
                uiFrom.closeUIForm();
            }   
        }
    }

    /**
     * 加载到缓存中, 
     * @param uiFormName 
     */
    private async loadUIToCurrentCache(uiFormName: string, obj: any) {
        let baseUIForm: BaseUIForm = null;
        let baseUIFormFromAllCache: BaseUIForm = null;

        baseUIForm = this._MapCurrentShowUIForms[uiFormName];
        if(baseUIForm != null) return ;                                     // 要加载的窗口正在显示

        baseUIFormFromAllCache = this._MapAllUIForms[uiFormName];
        if(baseUIFormFromAllCache != null) {
            await baseUIFormFromAllCache.__preInit(obj);
            this._MapCurrentShowUIForms[uiFormName] = baseUIFormFromAllCache;
            baseUIFormFromAllCache.disPlay();
        }
    }
    /**
     * 加载到栈中
     * @param uiFormName 
     */
    private async pushUIFormToStack(uiFormName: string, obj: any) {
        if(this._StaCurrentUIForms.length > 0) {
            let topUIForm = this._StaCurrentUIForms[this._StaCurrentUIForms.length-1];
            topUIForm.freeze();
        }
        let baseUIForm = this._MapAllUIForms[uiFormName];
        if(baseUIForm == null) return ;
        await baseUIForm.__preInit(obj);
        // 加入栈中, 同时设置其zIndex 使得后进入的窗体总是显示在上面
        this._StaCurrentUIForms.push(baseUIForm);       
        baseUIForm.node.zIndex = this._StaCurrentUIForms.length;
        baseUIForm.disPlay();
    }
    /**
     * 加载时, 关闭其他窗口
     */
    private async enterUIFormsAndHideOther(uiFormName: string, obj: any) {
        let baseUIForm = this._MapCurrentShowUIForms[uiFormName];
        if(baseUIForm != null) return ;

        // 隐藏其他窗口 
        for(let key in this._MapCurrentShowUIForms) {
            this._MapCurrentShowUIForms[key].hide();
            this._MapCurrentShowUIForms[key] = null;
            delete this._MapCurrentShowUIForms[key];
        }
        this._StaCurrentUIForms.forEach(uiForm => {
            uiForm.hide();
            this._MapCurrentShowUIForms[uiForm.UIFormName] = null;
            delete this._MapCurrentShowUIForms[uiForm.UIFormName];
        });

        let baseUIFormFromAll = this._MapAllUIForms[uiFormName];
        
        if(baseUIFormFromAll == null) return ;
        await baseUIFormFromAll.__preInit(obj);

        this._MapCurrentShowUIForms[uiFormName] = baseUIFormFromAll;
        baseUIFormFromAll.disPlay();
    }

    /** 加载到独立map中 */
    private async loadUIFormsToIndependent(uiFormName: string, obj: any) {
        let baseUIForm = this._MapAllUIForms[uiFormName];
        if(baseUIForm == null) return ;
        await baseUIForm.__preInit(obj);
        this._MapIndependentForms[uiFormName] = baseUIForm;
        baseUIForm.disPlay();
    }

    /**
     * --------------------------------- 关闭窗口 --------------------------
     */
    /**
     * 关闭一个UIForm
     * @param uiFormName 
     */
    private exitUIForms(uiFormName: string) {
        let baseUIForm = this._MapAllUIForms[uiFormName];
        if(baseUIForm == null) return ;
        baseUIForm.hide();
        this._MapCurrentShowUIForms[uiFormName] = null;
        delete this._MapCurrentShowUIForms[uiFormName];
        
    }
    private popUIForm() {
        if(this._StaCurrentUIForms.length >= 2) {
            let topUIForm = this._StaCurrentUIForms.pop();
            topUIForm.hide();
            topUIForm = this._StaCurrentUIForms[this._StaCurrentUIForms.length-1];
            topUIForm.reDisPlay();
        }else if(this._StaCurrentUIForms.length >= 1) {
            let topUIForm = this._StaCurrentUIForms.pop();
            topUIForm.hide();
        }
    }
    private exitUIFormsAndDisplayOther(uiFormName: string) {
        if(uiFormName == "" || uiFormName == null) return ;

        let baseUIForm = this._MapCurrentShowUIForms[uiFormName];
        if(baseUIForm == null) return ;
        baseUIForm.hide();
        this._MapCurrentShowUIForms[uiFormName] = null;
        delete this._MapCurrentShowUIForms[uiFormName];
    }
    private exitIndependentForms(uiFormName: string) {
        let baseUIForm = this._MapAllUIForms[uiFormName];
        if(baseUIForm == null) return ;
        baseUIForm.hide();
        this._MapIndependentForms[uiFormName] = null;
        delete this._MapIndependentForms[uiFormName];
    }

    /** 销毁 */
    private destoryForm(baseUIForm: BaseUIForm, uiFormName: string) {
        UILoader.getInstance().destoryForm(baseUIForm);
        // 从allmap中删除
        this._MapAllUIForms[uiFormName] = null;
        delete this._MapAllUIForms[uiFormName];
    }

    // update (dt) {}
}
